// Admin portal API. Every route is permission-checked and every mutation is
// written to the audit log.

import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { q, insert, update, tx, parseJson, getSetting, setSetting } from '../db/db.js';
import { requireRole, requirePerm, audit, ADMIN_PERMISSIONS, hasPerm } from '../lib/middleware.js';
import { hashPassword, newTotpSecret, decrypt } from '../lib/security.js';
import { HttpError, bad, conflict, notFound, id, nowIso, str, int, oneOf, localToday } from '../lib/util.js';
import { bookingOut, cancelBooking, processRefund, completeBooking } from '../services/bookings.js';
import { createPayouts, markPayoutPaid, accountBalances } from '../services/finance.js';
import { notifyBusiness, notifyUser } from '../services/notifications.js';
import { recomputeRating, venueDetail } from '../services/venues.js';
import { gateway } from '../services/gateway.js';

export const adminRouter = Router();
const r = adminRouter;
r.use(requireRole('admin'));

const page = (req) => ({ limit: Math.min(200, Number(req.query.limit) || 50), offset: Math.max(0, Number(req.query.offset) || 0) });

r.get('/me', (req, res) => res.json({ user: req.user, permissions: ADMIN_PERMISSIONS[req.user.admin_role] || [] }));

// ── Dashboard ──
r.get('/dashboard', requirePerm('dashboard'), (_req, res) => {
  const one = (sql, ...p) => q.get(sql, ...p);
  const GMV_STATUSES = "('CONFIRMED','UPCOMING','COMPLETED','CANCELLED','REFUND_PROCESSING','REFUNDED')";
  const today = localToday();
  res.json({
    gmv: one(`SELECT COALESCE(SUM(total),0) v FROM bookings WHERE source = 'online' AND paid_amount > 0 AND status IN ${GMV_STATUSES}`).v,
    collected: one('SELECT COALESCE(SUM(paid_amount),0) v FROM bookings').v,
    platform_revenue: one("SELECT COALESCE(SUM(credit - debit),0) v FROM financial_ledger WHERE account = 'PLATFORM_COMMISSION'").v,
    commission_booked: one("SELECT COALESCE(SUM(commission_amount),0) v FROM bookings WHERE paid_amount > 0").v,
    bookings: one("SELECT COUNT(*) v FROM bookings WHERE status NOT IN ('DRAFT','EXPIRED')").v,
    bookings_today: one('SELECT COUNT(*) v FROM bookings WHERE substr(created_at,1,10) = ?', today).v,
    customers: one("SELECT COUNT(*) v FROM users WHERE role = 'customer'").v,
    businesses: one('SELECT COUNT(*) v FROM businesses').v,
    venues: one("SELECT COUNT(*) v FROM venues WHERE status = 'PUBLISHED'").v,
    pending_verification: one("SELECT COUNT(*) v FROM businesses WHERE status IN ('SUBMITTED','UNDER_REVIEW','DOCUMENTS_VERIFIED')").v + one("SELECT COUNT(*) v FROM venues WHERE status IN ('SUBMITTED','UNDER_REVIEW','APPROVED')").v,
    pending_payout: one("SELECT COALESCE(SUM(business_payable),0) v FROM bookings WHERE payout_status IN ('ELIGIBLE','IN_PAYOUT')").v,
    pending_refunds: one("SELECT COUNT(*) c, COALESCE(SUM(amount),0) v FROM refunds WHERE status = 'PENDING'"),
    open_disputes: one("SELECT COUNT(*) v FROM disputes WHERE status IN ('OPEN','IN_REVIEW')").v,
    by_status: q.all('SELECT status, COUNT(*) c FROM bookings GROUP BY status ORDER BY c DESC'),
    daily: q.all(`SELECT substr(created_at,1,10) d, COUNT(*) bookings, COALESCE(SUM(paid_amount),0) collected FROM bookings WHERE created_at >= ? GROUP BY d ORDER BY d`, new Date(Date.now() - 30 * 86_400_000).toISOString()),
    top_cities: q.all("SELECT city, COUNT(*) c FROM venues WHERE status = 'PUBLISHED' GROUP BY city ORDER BY c DESC LIMIT 6"),
  });
});

// ── Customers ──
r.get('/customers', requirePerm('customers.read'), (req, res) => {
  const { limit, offset } = page(req);
  const s = req.query.q ? `%${req.query.q}%` : null;
  const rows = q.all(
    `SELECT u.id, u.name, u.phone, u.email, u.status, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id) AS bookings,
            (SELECT COALESCE(SUM(paid_amount),0) FROM bookings b WHERE b.customer_id = u.id) AS spent
       FROM users u WHERE u.role = 'customer' ${s ? 'AND (u.name LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)' : ''}
      ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    ...(s ? [s, s, s] : []), limit, offset,
  );
  res.json({ items: rows, total: q.get("SELECT COUNT(*) c FROM users WHERE role = 'customer'").c });
});

r.post('/customers/:id/status', requirePerm('customers.read'), (req, res) => {
  if (!hasPerm(req.user, 'businesses.verify')) throw new HttpError(403, 'FORBIDDEN', 'Not allowed');
  const u = q.get("SELECT * FROM users WHERE id = ? AND role = 'customer'", req.params.id);
  if (!u) throw notFound('Customer');
  const status = oneOf(req.body?.status, 'status', ['ACTIVE', 'BLOCKED']);
  update('users', u.id, { status });
  audit(req, 'customer.status', 'user', u.id, { status: u.status }, { status, reason: req.body?.reason });
  res.json({ ok: true });
});

// ── Businesses & verification ──
const BIZ_TRANSITIONS = {
  SUBMITTED: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['DOCUMENTS_VERIFIED', 'REJECTED'],
  DOCUMENTS_VERIFIED: ['APPROVED', 'REJECTED'],
  APPROVED: ['SUSPENDED'],
  SUSPENDED: ['APPROVED'],
  REJECTED: [],
  DRAFT: [],
};

r.get('/businesses', requirePerm('businesses.read'), (req, res) => {
  const { limit, offset } = page(req);
  const where = [];
  const params = [];
  if (req.query.status) { where.push('b.status = ?'); params.push(req.query.status); }
  if (req.query.q) { where.push('(b.name LIKE ? OR b.email LIKE ? OR b.phone LIKE ?)'); params.push(...Array(3).fill(`%${req.query.q}%`)); }
  const rows = q.all(
    `SELECT b.id, b.name, b.type, b.owner_name, b.phone, b.email, b.city, b.status, b.commission_bps, b.created_at, b.submitted_at, b.approved_at,
            (SELECT COUNT(*) FROM venues v WHERE v.business_id = b.id) AS venues,
            (SELECT COUNT(*) FROM business_documents d WHERE d.business_id = b.id) AS documents
       FROM businesses b ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(b.submitted_at, b.created_at) DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  res.json({ items: rows, counts: q.all('SELECT status, COUNT(*) c FROM businesses GROUP BY status') });
});

r.get('/businesses/:id', requirePerm('businesses.read'), (req, res) => {
  const b = q.get('SELECT * FROM businesses WHERE id = ?', req.params.id);
  if (!b) throw notFound('Business');
  const canSeeBank = hasPerm(req.user, 'payouts.manage');
  let bank = null;
  if (b.bank_account_enc) {
    bank = { holder: b.bank_holder, ifsc: b.bank_ifsc, account: canSeeBank ? decrypt(b.bank_account_enc) : `XXXXXX${b.bank_account_last4}` };
    if (canSeeBank) audit(req, 'business.bank_viewed', 'business', b.id);
  }
  res.json({
    business: { ...b, pan_enc: undefined, bank_account_enc: undefined, pan: b.pan_enc ? (hasPerm(req.user, 'businesses.verify') ? decrypt(b.pan_enc) : 'on file') : null, bank },
    venues: q.all('SELECT id, name, status, venue_type, city, area_name, location_verified, lat, lng, address, pincode, created_at FROM venues WHERE business_id = ?', b.id),
    documents: q.all('SELECT id, kind, file_name, mime, status, note, uploaded_at FROM business_documents WHERE business_id = ? ORDER BY uploaded_at DESC', b.id),
    events: q.all("SELECT * FROM verification_events WHERE entity_type = 'business' AND entity_id = ? ORDER BY at", b.id),
    allowed_transitions: BIZ_TRANSITIONS[b.status] || [],
  });
});

r.post('/businesses/:id/transition', requirePerm('businesses.verify'), (req, res) => {
  const b = q.get('SELECT * FROM businesses WHERE id = ?', req.params.id);
  if (!b) throw notFound('Business');
  const to = String(req.body?.to || '');
  if (!(BIZ_TRANSITIONS[b.status] || []).includes(to)) throw conflict('INVALID_TRANSITION', `Cannot move a ${b.status} business to ${to}`);
  const reason = to === 'REJECTED' || to === 'SUSPENDED' ? str(req.body?.reason, 'Reason', { max: 500 }) : str(req.body?.reason, 'Note', { max: 500, optional: true });
  if (to === 'DOCUMENTS_VERIFIED' && q.get("SELECT 1 FROM business_documents WHERE business_id = ? AND status != 'VERIFIED'", b.id)) {
    throw conflict('DOCS_PENDING', 'Verify or reject every document first');
  }
  tx(() => {
    const now = nowIso();
    const patch = { status: to, rejection_reason: to === 'REJECTED' || to === 'SUSPENDED' ? reason : null };
    if (to === 'APPROVED') patch.approved_at = now;
    // A rejected business goes back to DRAFT-equivalent editing; it resubmits via /submit.
    update('businesses', b.id, patch);
    insert('verification_events', { id: id('ver'), entity_type: 'business', entity_id: b.id, from_status: b.status, to_status: to, actor_id: req.user.id, note: reason, at: now });
    if (to === 'REJECTED') {
      for (const v of q.all("SELECT id, status FROM venues WHERE business_id = ? AND status IN ('SUBMITTED','UNDER_REVIEW')", b.id)) {
        update('venues', v.id, { status: 'DRAFT', rejection_reason: reason });
        insert('verification_events', { id: id('ver'), entity_type: 'venue', entity_id: v.id, from_status: v.status, to_status: 'DRAFT', actor_id: req.user.id, note: `Business rejected: ${reason}`, at: now });
      }
    }
    if (to === 'SUSPENDED') {
      for (const v of q.all("SELECT id, status FROM venues WHERE business_id = ? AND status = 'PUBLISHED'", b.id)) {
        update('venues', v.id, { status: 'SUSPENDED' });
        insert('verification_events', { id: id('ver'), entity_type: 'venue', entity_id: v.id, from_status: 'PUBLISHED', to_status: 'SUSPENDED', actor_id: req.user.id, note: 'Business suspended', at: now });
      }
    }
  });
  audit(req, 'business.transition', 'business', b.id, { status: b.status }, { status: to, reason });
  const msg = { UNDER_REVIEW: 'Your application is under review.', DOCUMENTS_VERIFIED: 'Your documents are verified.', APPROVED: 'Your business is approved! Venues can now be published.', REJECTED: `Your application needs changes: ${reason}`, SUSPENDED: `Your business is suspended: ${reason}` }[to];
  notifyBusiness(b.id, 'verification_update', `Verification: ${to.replace('_', ' ').toLowerCase()}`, msg || `Status changed to ${to}`, {});
  res.json({ ok: true, status: to });
});

r.post('/businesses/:id/commission', requirePerm('payouts.manage'), (req, res) => {
  const b = q.get('SELECT * FROM businesses WHERE id = ?', req.params.id);
  if (!b) throw notFound('Business');
  const bps = int(req.body?.commission_bps, 'Commission (basis points)', { min: 0, max: 5000 });
  update('businesses', b.id, { commission_bps: bps });
  audit(req, 'business.commission', 'business', b.id, { commission_bps: b.commission_bps }, { commission_bps: bps });
  res.json({ ok: true });
});

r.get('/documents/:id', requirePerm('businesses.verify'), (req, res) => {
  const d = q.get('SELECT * FROM business_documents WHERE id = ?', req.params.id);
  if (!d) throw notFound('Document');
  const file = path.join(config.storageDir, 'private', d.storage_key);
  if (!fs.existsSync(file)) throw notFound('File');
  audit(req, 'document.view', 'business_document', d.id);
  res.setHeader('Content-Type', d.mime);
  res.setHeader('Content-Disposition', `inline; filename="${d.file_name.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
});

r.post('/documents/:id/review', requirePerm('businesses.verify'), (req, res) => {
  const d = q.get('SELECT * FROM business_documents WHERE id = ?', req.params.id);
  if (!d) throw notFound('Document');
  const status = oneOf(req.body?.status, 'status', ['VERIFIED', 'REJECTED']);
  const note = status === 'REJECTED' ? str(req.body?.note, 'Reason', { max: 300 }) : str(req.body?.note, 'Note', { max: 300, optional: true });
  update('business_documents', d.id, { status, note });
  audit(req, 'document.review', 'business_document', d.id, { status: d.status }, { status, note });
  res.json({ ok: true });
});

// ── Venues ──
const VENUE_TRANSITIONS = {
  SUBMITTED: ['UNDER_REVIEW', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED: ['PUBLISHED', 'DRAFT'],
  PUBLISHED: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['PUBLISHED', 'ARCHIVED'],
  DRAFT: [],
  ARCHIVED: [],
};

r.get('/venues', requirePerm('venues.read'), (req, res) => {
  const { limit, offset } = page(req);
  const where = [];
  const params = [];
  if (req.query.status) { where.push('v.status = ?'); params.push(req.query.status); }
  if (req.query.q) { where.push('(v.name LIKE ? OR v.city LIKE ? OR v.area_name LIKE ?)'); params.push(...Array(3).fill(`%${req.query.q}%`)); }
  const rows = q.all(
    `SELECT v.id, v.name, v.venue_type, v.city, v.area_name, v.status, v.location_verified, v.rating_avg, v.rating_count, v.starting_price, v.capacity_max, v.booking_count, v.created_at, b.name AS business_name, b.status AS business_status
       FROM venues v JOIN businesses b ON b.id = v.business_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY v.created_at DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  res.json({ items: rows, counts: q.all('SELECT status, COUNT(*) c FROM venues GROUP BY status') });
});

r.get('/venues/:id', requirePerm('venues.read'), (req, res) => {
  const v = q.get('SELECT * FROM venues WHERE id = ?', req.params.id);
  if (!v) throw notFound('Venue');
  res.json({
    ...venueDetail(v),
    status: v.status,
    rejection_reason: v.rejection_reason,
    business: q.get('SELECT id, name, status FROM businesses WHERE id = ?', v.business_id),
    events: q.all("SELECT * FROM verification_events WHERE entity_type = 'venue' AND entity_id = ? ORDER BY at", v.id),
    allowed_transitions: VENUE_TRANSITIONS[v.status] || [],
  });
});

r.post('/venues/:id/transition', requirePerm('venues.verify'), (req, res) => {
  const v = q.get('SELECT * FROM venues WHERE id = ?', req.params.id);
  if (!v) throw notFound('Venue');
  const to = String(req.body?.to || '');
  if (!(VENUE_TRANSITIONS[v.status] || []).includes(to)) throw conflict('INVALID_TRANSITION', `Cannot move a ${v.status} venue to ${to}`);
  const needsReason = ['DRAFT', 'SUSPENDED', 'ARCHIVED'].includes(to);
  const reason = needsReason ? str(req.body?.reason, 'Reason', { max: 500 }) : str(req.body?.reason, 'Note', { max: 500, optional: true });
  if (to === 'PUBLISHED') {
    const biz = q.get('SELECT status FROM businesses WHERE id = ?', v.business_id);
    if (biz.status !== 'APPROVED') throw conflict('BUSINESS_NOT_APPROVED', 'Approve the business before publishing its venues');
    if (!v.location_verified) throw conflict('LOCATION_UNVERIFIED', 'Verify the venue location before publishing');
    if (!q.get('SELECT 1 FROM venue_spaces WHERE venue_id = ? AND active = 1', v.id)) throw conflict('NO_SPACES', 'Venue has no active spaces');
  }
  if (to === 'ARCHIVED' && q.get("SELECT 1 FROM bookings WHERE venue_id = ? AND status IN ('CONFIRMED','UPCOMING','PENDING_PAYMENT','PAYMENT_PROCESSING','REQUESTED')", v.id)) {
    throw conflict('HAS_BOOKINGS', 'Venue has active bookings; suspend it instead');
  }
  const now = nowIso();
  update('venues', v.id, { status: to, rejection_reason: to === 'DRAFT' ? reason : null, ...(to === 'PUBLISHED' && !v.published_at ? { published_at: now } : {}) });
  insert('verification_events', { id: id('ver'), entity_type: 'venue', entity_id: v.id, from_status: v.status, to_status: to, actor_id: req.user.id, note: reason, at: now });
  audit(req, 'venue.transition', 'venue', v.id, { status: v.status }, { status: to, reason });
  const msg = { UNDER_REVIEW: `${v.name} is under review.`, APPROVED: `${v.name} is approved and will be published shortly.`, PUBLISHED: `${v.name} is live! Customers can now find and book it.`, DRAFT: `${v.name} needs changes: ${reason}`, SUSPENDED: `${v.name} is suspended: ${reason}`, ARCHIVED: `${v.name} was archived.` }[to];
  notifyBusiness(v.business_id, 'verification_update', `Venue ${to.toLowerCase().replace('_', ' ')}`, msg, { venue_id: v.id });
  res.json({ ok: true, status: to });
});

r.post('/venues/:id/verify-location', requirePerm('venues.verify'), (req, res) => {
  const v = q.get('SELECT * FROM venues WHERE id = ?', req.params.id);
  if (!v) throw notFound('Venue');
  if (v.lat == null) throw conflict('NO_PIN', 'The venue has not placed its map pin yet');
  const verified = req.body?.verified !== false;
  update('venues', v.id, { location_verified: verified ? 1 : 0 });
  insert('verification_events', { id: id('ver'), entity_type: 'venue', entity_id: v.id, from_status: v.status, to_status: v.status, actor_id: req.user.id, note: verified ? `Location verified (${v.lat.toFixed(5)}, ${v.lng.toFixed(5)})` : `Location rejected: ${req.body?.reason || ''}`, at: nowIso() });
  audit(req, 'venue.verify_location', 'venue', v.id, { location_verified: v.location_verified }, { location_verified: verified });
  res.json({ ok: true, location_verified: verified });
});

// ── Bookings ──
r.get('/bookings', requirePerm('bookings.read'), (req, res) => {
  const { limit, offset } = page(req);
  const where = [];
  const params = [];
  if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.source) { where.push('source = ?'); params.push(req.query.source); }
  if (req.query.q) { where.push('(code LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)'); params.push(...Array(3).fill(`%${req.query.q}%`)); }
  const rows = q.all(`SELECT * FROM bookings ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ items: rows.map((b) => bookingOut(b, 'admin')), total: q.get(`SELECT COUNT(*) c FROM bookings ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, ...params).c });
});

r.get('/bookings/:id', requirePerm('bookings.read'), (req, res) => {
  const b = q.get('SELECT * FROM bookings WHERE id = ? OR code = ?', req.params.id, req.params.id);
  if (!b) throw notFound('Booking');
  res.json({ ...bookingOut(b, 'admin', { full: true }), messages: q.all('SELECT * FROM messages WHERE booking_id = ? ORDER BY at', b.id), disputes: q.all('SELECT * FROM disputes WHERE booking_id = ?', b.id), ledger: q.all('SELECT * FROM financial_ledger WHERE booking_id = ? ORDER BY at', b.id) });
});

r.post('/bookings/:id/cancel', requirePerm('refunds.manage'), (req, res) => {
  const reason = str(req.body?.reason, 'Reason', { max: 300 });
  const out = cancelBooking(req.user, req.params.id, { reason, by: 'admin', refundOverride: req.body?.refund_amount });
  audit(req, 'booking.admin_cancel', 'booking', out.id, null, { reason, refund_amount: req.body?.refund_amount });
  res.json(bookingOut(out, 'admin', { full: true }));
});

r.post('/bookings/:id/complete', requirePerm('bookings.read'), (req, res) => {
  if (!hasPerm(req.user, 'disputes.manage')) throw new HttpError(403, 'FORBIDDEN', 'Not allowed');
  const out = completeBooking(req.user, req.params.id);
  audit(req, 'booking.admin_complete', 'booking', out.id);
  res.json(bookingOut(out, 'admin', { full: true }));
});

// ── Payments, refunds, payouts, finance ──
r.get('/payments', requirePerm('payments.read'), (req, res) => {
  const { limit, offset } = page(req);
  const rows = q.all(
    `SELECT p.*, b.code AS booking_code, b.customer_name FROM payments p JOIN bookings b ON b.id = p.booking_id
      ${req.query.status ? 'WHERE p.status = ?' : ''} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    ...(req.query.status ? [req.query.status] : []), limit, offset,
  );
  res.json({ items: rows });
});

// Reconciliation: our payment records vs. what the gateway says.
r.get('/reconciliation', requirePerm('finance.read'), (_req, res) => {
  const rows = q.all("SELECT p.*, b.code FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.created_at >= ? ORDER BY p.created_at DESC", new Date(Date.now() - 30 * 86_400_000).toISOString());
  const items = rows.map((p) => {
    const remote = gateway.fetchOrder(p.gateway_order_id);
    const expected = { CAPTURED: 'paid', FAILED: 'failed' }[p.status];
    const mismatch = remote && ((p.status === 'CAPTURED' && (remote.status !== 'paid' || remote.amount !== p.amount)) || (remote.status === 'paid' && p.status !== 'CAPTURED'));
    return { payment_id: p.id, booking_code: p.code, amount: p.amount, our_status: p.status, gateway_status: remote?.status ?? 'missing', gateway_amount: remote?.amount ?? null, expected_gateway_status: expected ?? null, mismatch: Boolean(mismatch) };
  });
  res.json({ items, mismatches: items.filter((i) => i.mismatch).length });
});

r.get('/refunds', requirePerm('refunds.manage'), (req, res) => {
  res.json({ items: q.all(`SELECT r.*, b.code AS booking_code, b.customer_name FROM refunds r JOIN bookings b ON b.id = r.booking_id ${req.query.status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT 200`, ...(req.query.status ? [req.query.status] : [])) });
});

r.post('/refunds/:id/process', requirePerm('refunds.manage'), (req, res) => {
  const out = processRefund(req.params.id, req.user);
  audit(req, 'refund.process', 'refund', out.id, null, { amount: out.amount, gateway_refund_id: out.gateway_refund_id });
  res.json(out);
});

r.get('/payouts', requirePerm('payouts.manage'), (_req, res) => {
  res.json({
    items: q.all('SELECT p.*, b.name AS business_name, b.bank_ifsc, b.bank_account_last4 FROM payouts p JOIN businesses b ON b.id = p.business_id ORDER BY p.created_at DESC LIMIT 200'),
    eligible: q.all("SELECT b.business_id, bz.name AS business_name, COUNT(*) bookings, SUM(b.business_payable) amount, (bz.bank_account_enc IS NOT NULL) AS has_bank FROM bookings b JOIN businesses bz ON bz.id = b.business_id WHERE b.payout_status = 'ELIGIBLE' AND b.business_payable > 0 GROUP BY b.business_id"),
  });
});

r.post('/payouts/run', requirePerm('payouts.manage'), (req, res) => {
  const created = tx(() => createPayouts(req.user.id, req.body?.business_id || null));
  audit(req, 'payout.batch_create', 'payout', created.map((p) => p.id).join(','), null, { count: created.length, total: created.reduce((a, p) => a + p.amount, 0) });
  res.json({ created });
});

r.post('/payouts/:id/mark-paid', requirePerm('payouts.manage'), (req, res) => {
  const reference = str(req.body?.reference, 'Bank reference (UTR)', { max: 60 });
  const out = tx(() => markPayoutPaid(req.params.id, reference));
  audit(req, 'payout.paid', 'payout', out.id, null, { reference, amount: out.amount });
  notifyBusiness(out.business_id, 'payout_processed', 'Payout sent', `₹${out.amount.toLocaleString('en-IN')} sent to your bank account (UTR ${reference}).`, { payout_id: out.id });
  res.json(out);
});

r.get('/ledger', requirePerm('finance.read'), (req, res) => {
  const { limit, offset } = page(req);
  const where = [];
  const params = [];
  if (req.query.account) { where.push('account = ?'); params.push(req.query.account); }
  if (req.query.business_id) { where.push('business_id = ?'); params.push(req.query.business_id); }
  res.json({
    items: q.all(`SELECT * FROM financial_ledger ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, rowid DESC LIMIT ? OFFSET ?`, ...params, limit, offset),
    balances: accountBalances(),
    unbalanced_txns: q.all('SELECT txn_id, SUM(debit) d, SUM(credit) c FROM financial_ledger GROUP BY txn_id HAVING d != c'),
  });
});

r.get('/finance/summary', requirePerm('finance.read'), (_req, res) => {
  const balances = accountBalances();
  const g = (k) => balances[k]?.balance ?? 0;
  res.json({
    balances,
    collected: q.get("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status = 'CAPTURED'").v,
    refunded: q.get("SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE status = 'PROCESSED'").v,
    refunds_pending: q.get("SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE status = 'PENDING'").v,
    platform_commission: g('PLATFORM_COMMISSION'),
    customer_deposits_held: g('CUSTOMER_DEPOSITS'),
    business_payable: g('BUSINESS_PAYABLE'),
    paid_out: q.get("SELECT COALESCE(SUM(amount),0) v FROM payouts WHERE status = 'PAID'").v,
    // GST attributable to money actually held: tax × (paid − refunded) / total.
    gst_collected: Math.round(q.get("SELECT COALESCE(SUM(CAST(tax AS REAL) * (paid_amount - refunded_amount) / total),0) v FROM bookings WHERE paid_amount > 0 AND total > 0").v),
    gst_invoiced: q.get("SELECT COALESCE(SUM(tax),0) v FROM bookings WHERE paid_amount > 0 AND status NOT IN ('EXPIRED','REFUNDED')").v,
    monthly: q.all("SELECT substr(at,1,7) m, account, SUM(credit - debit) net FROM financial_ledger WHERE account IN ('PLATFORM_COMMISSION','BANK_PAYOUTS') GROUP BY m, account ORDER BY m"),
  });
});

// ── Reviews & disputes ──
r.get('/reviews', requirePerm('reviews.moderate'), (req, res) => {
  res.json({ items: q.all(`SELECT r.*, v.name AS venue_name, u.name AS customer_name, b.code FROM reviews r JOIN venues v ON v.id = r.venue_id JOIN users u ON u.id = r.customer_id JOIN bookings b ON b.id = r.booking_id ${req.query.status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT 200`, ...(req.query.status ? [req.query.status] : [])) });
});

r.post('/reviews/:id/status', requirePerm('reviews.moderate'), (req, res) => {
  const rv = q.get('SELECT * FROM reviews WHERE id = ?', req.params.id);
  if (!rv) throw notFound('Review');
  const status = oneOf(req.body?.status, 'status', ['PUBLISHED', 'HIDDEN']);
  const reason = str(req.body?.reason, 'Reason', { max: 300, optional: status === 'PUBLISHED' });
  update('reviews', rv.id, { status });
  recomputeRating(rv.venue_id);
  audit(req, 'review.moderate', 'review', rv.id, { status: rv.status }, { status, reason });
  res.json({ ok: true });
});

r.get('/disputes', requirePerm('disputes.manage'), (_req, res) => {
  res.json({ items: q.all('SELECT d.*, b.code AS booking_code, b.venue_id, b.customer_name FROM disputes d JOIN bookings b ON b.id = d.booking_id ORDER BY d.created_at DESC LIMIT 200') });
});

r.post('/disputes/:id/resolve', requirePerm('disputes.manage'), (req, res) => {
  const d = q.get('SELECT * FROM disputes WHERE id = ?', req.params.id);
  if (!d) throw notFound('Dispute');
  const status = oneOf(req.body?.status, 'status', ['IN_REVIEW', 'RESOLVED', 'REJECTED']);
  const resolution = str(req.body?.resolution, 'Resolution', { max: 2000, optional: status === 'IN_REVIEW' });
  update('disputes', d.id, { status, resolution, resolved_at: status === 'IN_REVIEW' ? null : nowIso() });
  audit(req, 'dispute.update', 'dispute', d.id, { status: d.status }, { status, resolution });
  const bk = q.get('SELECT customer_id, code FROM bookings WHERE id = ?', d.booking_id);
  if (status !== 'IN_REVIEW' && bk?.customer_id) notifyUser(bk.customer_id, 'message', `Update on your issue (${bk.code})`, resolution || status, { booking_id: d.booking_id });
  res.json({ ok: true });
});

// ── Catalog: categories, coupons, locations ──
r.get('/categories', requirePerm('catalog.manage'), (_req, res) => res.json({ items: q.all('SELECT * FROM event_categories ORDER BY sort') }));

r.put('/categories/:code', requirePerm('catalog.manage'), (req, res) => {
  const code = String(req.params.code).toLowerCase();
  if (!/^[a-z_]{2,30}$/.test(code)) throw bad('Code must be lowercase letters/underscores');
  const row = { code, name: str(req.body?.name, 'Name', { max: 40 }), icon: str(req.body?.icon || 'sparkle', 'Icon', { max: 30 }), sort: int(req.body?.sort ?? 99, 'Sort', { max: 999 }), active: req.body?.active === false ? 0 : 1 };
  q.run('INSERT INTO event_categories (code, name, icon, sort, active) VALUES (?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name, icon = excluded.icon, sort = excluded.sort, active = excluded.active', row.code, row.name, row.icon, row.sort, row.active);
  audit(req, 'category.upsert', 'event_category', code, null, row);
  res.json(row);
});

r.get('/coupons', requirePerm('catalog.manage'), (_req, res) => res.json({ items: q.all('SELECT * FROM coupons ORDER BY code') }));

r.put('/coupons/:code', requirePerm('catalog.manage'), (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw bad('Coupon code must be 3–20 letters/digits');
  const x = req.body || {};
  const row = {
    code,
    description: str(x.description, 'Description', { max: 200, optional: true }),
    kind: oneOf(x.kind, 'Kind', ['percent', 'flat']),
    value: int(x.value, 'Value', { min: 1, max: x.kind === 'percent' ? 90 : 10_000_000 }),
    max_discount: int(x.max_discount, 'Max discount', { min: 1, optional: true }),
    min_subtotal: int(x.min_subtotal ?? 0, 'Minimum booking value'),
    valid_from: x.valid_from || null,
    valid_to: x.valid_to || null,
    active: x.active === false ? 0 : 1,
  };
  q.run(`INSERT INTO coupons (code, description, kind, value, max_discount, min_subtotal, valid_from, valid_to, active) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(code) DO UPDATE SET description=excluded.description, kind=excluded.kind, value=excluded.value, max_discount=excluded.max_discount, min_subtotal=excluded.min_subtotal, valid_from=excluded.valid_from, valid_to=excluded.valid_to, active=excluded.active`,
  ...Object.values(row));
  audit(req, 'coupon.upsert', 'coupon', code, null, row);
  res.json(row);
});

r.get('/locations', requirePerm('catalog.manage'), (_req, res) => {
  res.json({
    cities: q.all('SELECT c.*, (SELECT COUNT(*) FROM venues v WHERE v.city = c.name AND v.status = \'PUBLISHED\') AS venues FROM cities c ORDER BY name'),
    areas: q.all('SELECT a.*, c.name AS city_name FROM areas a JOIN cities c ON c.id = a.city_id ORDER BY c.name, a.name'),
  });
});

// ── Settings, admins, audit ──
r.get('/settings', requirePerm('*'), (_req, res) => {
  res.json({ tax_rate_bps: getSetting('tax_rate_bps', 1800), hold_minutes: getSetting('hold_minutes', 15), default_commission_bps: getSetting('default_commission_bps', 1000) });
});

r.put('/settings', requirePerm('*'), (req, res) => {
  const before = { tax_rate_bps: getSetting('tax_rate_bps', 1800), hold_minutes: getSetting('hold_minutes', 15), default_commission_bps: getSetting('default_commission_bps', 1000) };
  if (req.body?.tax_rate_bps != null) setSetting('tax_rate_bps', int(req.body.tax_rate_bps, 'GST (bps)', { max: 2800 }));
  if (req.body?.hold_minutes != null) setSetting('hold_minutes', int(req.body.hold_minutes, 'Hold minutes', { min: 5, max: 60 }));
  if (req.body?.default_commission_bps != null) setSetting('default_commission_bps', int(req.body.default_commission_bps, 'Default commission', { max: 5000 }));
  audit(req, 'settings.update', 'settings', 'platform', before, req.body);
  res.json({ ok: true });
});

r.get('/admins', requirePerm('*'), (_req, res) => {
  res.json({ items: q.all("SELECT id, name, email, admin_role, status, created_at, last_login_at FROM users WHERE role = 'admin' ORDER BY created_at"), roles: ADMIN_PERMISSIONS });
});

r.post('/admins', requirePerm('*'), (req, res) => {
  const email = str(req.body?.email, 'Email', { max: 120 }).toLowerCase();
  if (q.get('SELECT 1 FROM users WHERE email = ?', email)) throw conflict('EXISTS', 'Email already in use');
  const password = str(req.body?.password, 'Temporary password', { min: 10, max: 128 });
  const secret = newTotpSecret();
  const u = { id: id('usr'), role: 'admin', name: str(req.body?.name, 'Name', { max: 80 }), email, password_hash: hashPassword(password), admin_role: oneOf(req.body?.admin_role, 'Role', Object.keys(ADMIN_PERMISSIONS)), totp_secret: secret, created_at: nowIso() };
  insert('users', u);
  audit(req, 'admin.create', 'user', u.id, null, { email, admin_role: u.admin_role });
  // With 2FA on, the TOTP secret is shown exactly once, for the new admin to enrol.
  res.status(201).json({
    id: u.id, email, admin_role: u.admin_role,
    ...(config.adminTwoFactor ? { totp_secret: secret, otpauth_url: `otpauth://totp/Pandal:${encodeURIComponent(email)}?secret=${secret}&issuer=Pandal` } : {}),
  });
});

r.get('/audit-logs', requirePerm('audit.read'), (req, res) => {
  const { limit, offset } = page(req);
  const where = [];
  const params = [];
  if (req.query.entity_type) { where.push('a.entity_type = ?'); params.push(req.query.entity_type); }
  if (req.query.entity_id) { where.push('a.entity_id = ?'); params.push(req.query.entity_id); }
  if (req.query.action) { where.push('a.action LIKE ?'); params.push(`${req.query.action}%`); }
  res.json({ items: q.all(`SELECT a.*, u.name AS actor_name, u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.at DESC LIMIT ? OFFSET ?`, ...params, limit, offset).map((a) => ({ ...a, before: parseJson(a.before, a.before), after: parseJson(a.after, a.after) })) });
});
