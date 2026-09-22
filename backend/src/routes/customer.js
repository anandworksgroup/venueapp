import { Router } from 'express';
import { q, insert } from '../db/db.js';
import { requireRole, rateLimit } from '../lib/middleware.js';
import { verifyJwt } from '../lib/security.js';
import { HttpError, bad, conflict, notFound, id, nowIso, str, int, localToday } from '../lib/util.js';
import { createBooking, startPayment, verifyAndCapture, cancelBooking, bookingOut, loadBookingFor, ACTIVE_STATUSES } from '../services/bookings.js';
import { renderInvoice } from '../lib/invoice.js';
import { listFor, markRead, notifyBusiness } from '../services/notifications.js';
import { recomputeRating, venueCard } from '../services/venues.js';

export const customerRouter = Router();
const r = customerRouter;
const customer = requireRole('customer');

// ── Bookings ──
r.post('/bookings', customer, rateLimit({ windowMs: 60_000, max: 20, name: 'book' }), (req, res) => {
  const b = req.body || {};
  const booking = createBooking(req.user, {
    venue_id: b.venue_id,
    space_id: b.space_id,
    date: b.date,
    slot: b.slot,
    guests: b.guests,
    event_type: b.event_type,
    package_id: b.package_id || null,
    service_ids: Array.isArray(b.service_ids) ? b.service_ids : [],
    coupon_code: b.coupon_code || null,
    contact: b.contact,
    notes: b.notes,
  }, req.get('Idempotency-Key') || null);
  res.status(201).json(bookingOut(booking, 'customer', { full: true }));
});

r.get('/bookings', customer, (req, res) => {
  const rows = q.all('SELECT * FROM bookings WHERE customer_id = ? ORDER BY event_date DESC, created_at DESC', req.user.id);
  const today = localToday();
  const items = rows.map((b) => bookingOut(b, 'customer'));
  res.json({
    upcoming: items.filter((b) => ACTIVE_STATUSES.includes(b.status) && b.event_date >= today).sort((a, b) => a.event_date.localeCompare(b.event_date)),
    past: items.filter((b) => !(ACTIVE_STATUSES.includes(b.status) && b.event_date >= today)),
  });
});

r.get('/bookings/:id', customer, (req, res) => {
  res.json(bookingOut(loadBookingFor(req.user, req.params.id), 'customer', { full: true }));
});

r.post('/bookings/:id/pay', customer, rateLimit({ windowMs: 60_000, max: 15, name: 'pay' }), (req, res) => {
  res.json(startPayment(req.user, req.params.id, { purpose: req.body?.purpose || 'advance', returnUrl: req.body?.return_url }));
});

r.post('/bookings/:id/cancel', customer, (req, res) => {
  const reason = str(req.body?.reason, 'Reason', { max: 300, optional: true });
  res.json(bookingOut(cancelBooking(req.user, req.params.id, { reason, by: 'customer' }), 'customer', { full: true }));
});

// Invoice: token may come as a query param so the link opens in a browser.
r.get('/bookings/:id/invoice', (req, res) => {
  const user = req.user || (() => {
    const p = verifyJwt(String(req.query.token || ''));
    return p ? q.get('SELECT id, role FROM users WHERE id = ?', p.sub) : null;
  })();
  if (!user || user.role !== 'customer') throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
  const b = loadBookingFor(user, req.params.id);
  if (!b.paid_amount) throw conflict('NO_INVOICE', 'An invoice is available once a payment is made');
  res.type('html').send(renderInvoice(b));
});

// Payment verification from the app after the gateway redirect. The booking
// is confirmed only if the server can verify the payment with the gateway.
r.post('/payments/verify', customer, rateLimit({ windowMs: 60_000, max: 30, name: 'verify' }), (req, res) => {
  const { order_id, payment_id, signature } = req.body || {};
  if (!order_id) throw bad('order_id is required');
  const pay = q.get('SELECT p.booking_id, b.customer_id FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.gateway_order_id = ?', order_id);
  if (!pay || pay.customer_id !== req.user.id) throw notFound('Payment');
  const result = payment_id && signature
    ? verifyAndCapture({ orderId: order_id, paymentId: payment_id, signature }, 'client')
    : verifyAndCapture({ orderId: order_id }, 'poll');
  res.json({ outcome: result.outcome, booking: bookingOut(result.booking, 'customer', { full: true }) });
});

// ── Messages (relay through the platform; no phone numbers exchanged) ──
r.get('/bookings/:id/messages', customer, (req, res) => {
  const b = loadBookingFor(req.user, req.params.id);
  res.json({ items: q.all('SELECT id, sender_role, body, at FROM messages WHERE booking_id = ? ORDER BY at', b.id) });
});

r.post('/bookings/:id/messages', customer, rateLimit({ windowMs: 60_000, max: 20, name: 'msg' }), (req, res) => {
  const b = loadBookingFor(req.user, req.params.id);
  const body = str(req.body?.body, 'Message', { max: 1000 });
  const m = { id: id('msg'), booking_id: b.id, sender_role: 'customer', sender_id: req.user.id, body, at: nowIso() };
  insert('messages', m);
  notifyBusiness(b.business_id, 'customer_message', `Message on ${b.code}`, body.slice(0, 120), { booking_id: b.id });
  res.status(201).json(m);
});

// ── Reviews: only a completed, verified booking can be reviewed, once. ──
r.post('/bookings/:id/review', customer, (req, res) => {
  const b = loadBookingFor(req.user, req.params.id);
  if (b.status !== 'COMPLETED' || b.source !== 'online') throw conflict('NOT_REVIEWABLE', 'You can review a venue after your event is completed');
  if (q.get('SELECT 1 FROM reviews WHERE booking_id = ?', b.id)) throw conflict('ALREADY_REVIEWED', 'You have already reviewed this booking');
  const x = req.body || {};
  const rating = (v, name, optional = true) => int(v, name, { min: 1, max: 5, optional });
  const review = {
    id: id('rev'),
    booking_id: b.id,
    venue_id: b.venue_id,
    customer_id: req.user.id,
    overall: rating(x.overall, 'Overall rating', false),
    venue_rating: rating(x.venue, 'Venue'),
    food: rating(x.food, 'Food'),
    service: rating(x.service, 'Service'),
    cleanliness: rating(x.cleanliness, 'Cleanliness'),
    value: rating(x.value, 'Value'),
    body: str(x.body, 'Review', { max: 2000, optional: true }),
    created_at: nowIso(),
  };
  insert('reviews', review);
  recomputeRating(b.venue_id);
  notifyBusiness(b.business_id, 'new_review', `New ${review.overall}★ review`, review.body ? review.body.slice(0, 120) : `For ${b.code}`, { booking_id: b.id, review_id: review.id });
  res.status(201).json(review);
});

// ── Disputes ──
r.post('/bookings/:id/disputes', customer, (req, res) => {
  const b = loadBookingFor(req.user, req.params.id);
  const d = { id: id('dsp'), booking_id: b.id, raised_by: req.user.id, raised_role: 'customer', subject: str(req.body?.subject, 'Subject', { max: 120 }), body: str(req.body?.body, 'Details', { max: 3000 }), status: 'OPEN', created_at: nowIso() };
  insert('disputes', d);
  res.status(201).json(d);
});

// ── Saved venues ──
r.get('/saved', customer, (req, res) => {
  const rows = q.all("SELECT v.* FROM saved_venues s JOIN venues v ON v.id = s.venue_id WHERE s.user_id = ? AND v.status = 'PUBLISHED' ORDER BY s.saved_at DESC", req.user.id);
  res.json({ items: rows.map((v) => venueCard(v, { lat: req.query.lat != null ? Number(req.query.lat) : null, lng: req.query.lng != null ? Number(req.query.lng) : null })) });
});

r.put('/saved/:venueId', customer, (req, res) => {
  if (!q.get("SELECT 1 FROM venues WHERE id = ? AND status = 'PUBLISHED'", req.params.venueId)) throw notFound('Venue');
  q.run('INSERT OR IGNORE INTO saved_venues (user_id, venue_id, saved_at) VALUES (?, ?, ?)', req.user.id, req.params.venueId, nowIso());
  res.json({ saved: true });
});

r.delete('/saved/:venueId', customer, (req, res) => {
  q.run('DELETE FROM saved_venues WHERE user_id = ? AND venue_id = ?', req.user.id, req.params.venueId);
  res.json({ saved: false });
});

// ── Notifications ──
r.get('/notifications', customer, (req, res) => res.json(listFor({ userId: req.user.id })));
r.post('/notifications/read', customer, (req, res) => {
  markRead({ userId: req.user.id, ids: Array.isArray(req.body?.ids) ? req.body.ids : null });
  res.json({ ok: true });
});

