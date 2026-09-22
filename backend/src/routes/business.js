// Business portal API. Every query is scoped to req.business (resolved from
// the signed-in user), so one business can never read or change another's data.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { q, insert, update, parseJson, tx } from '../db/db.js';
import { requireBusiness, audit } from '../lib/middleware.js';
import { encrypt } from '../lib/security.js';
import { HttpError, bad, conflict, notFound, id, nowIso, str, int, oneOf, arrOf, normPhone, localToday, addDays } from '../lib/util.js';
import { VENUE_TYPES, FACILITIES, IMAGE_CATEGORIES, SERVICE_CATEGORIES, BUSINESS_TYPES, DOCUMENT_KINDS, DEFAULT_CANCELLATION_POLICY } from '../services/catalog.js';
import { recomputeVenueAggregates, venueDetail } from '../services/venues.js';
import { matchPlaces, nearestArea } from '../services/location.js';
import { createOfflineBooking, createBlock, removeBlock, cancelBooking, completeBooking, respondToRequest, bookingOut, loadBookingFor } from '../services/bookings.js';
import { businessFinance } from '../services/finance.js';
import { listFor, markRead, notifyUser } from '../services/notifications.js';

export const businessRouter = Router();
const r = businessRouter;
r.use(requireBusiness);

const need = (req) => {
  if (!req.business) throw new HttpError(409, 'NO_BUSINESS', 'Create your business profile first');
  return req.business;
};
const actor = (req) => ({ id: req.user.id, role: 'business' });

const EDITABLE_VENUE = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'SUSPENDED'];

function ownVenue(req, venueId) {
  const v = q.get('SELECT * FROM venues WHERE id = ? AND business_id = ?', venueId, need(req).id);
  if (!v) throw notFound('Venue');
  return v;
}

function bizOut(b) {
  if (!b) return null;
  return {
    id: b.id, type: b.type, name: b.name, legal_name: b.legal_name, owner_name: b.owner_name, phone: b.phone, email: b.email,
    gstin: b.gstin, has_pan: Boolean(b.pan_enc), bank_holder: b.bank_holder, bank_ifsc: b.bank_ifsc,
    bank_account_masked: b.bank_account_last4 ? `XXXXXX${b.bank_account_last4}` : null,
    address: b.address, city: b.city, state: b.state, pincode: b.pincode,
    status: b.status, rejection_reason: b.rejection_reason, commission_bps: b.commission_bps,
    created_at: b.created_at, submitted_at: b.submitted_at, approved_at: b.approved_at,
  };
}

// ── Business profile & onboarding ──
r.get('/me', (req, res) => {
  const b = req.business;
  if (!b) return res.json({ business: null, venues: [], documents: [], checklist: null, user: req.user });
  const venues = q.all('SELECT id, name, status FROM venues WHERE business_id = ?', b.id);
  const docs = q.all('SELECT id, kind, file_name, status, note, uploaded_at FROM business_documents WHERE business_id = ? ORDER BY uploaded_at DESC', b.id);
  const v = venues[0] ? q.get('SELECT * FROM venues WHERE id = ?', venues[0].id) : null;
  const count = (sql, ...p) => q.get(sql, ...p).c;
  const checklist = [
    { key: 'business', label: 'Business information', done: Boolean(b.name && b.owner_name && b.phone) },
    { key: 'address', label: 'Address', done: Boolean(b.address && b.city && b.pincode) },
    { key: 'venue', label: 'Venue details', done: Boolean(v?.description && v?.venue_type) },
    { key: 'location', label: 'Exact venue location (map pin)', done: Boolean(v?.lat && v?.lng) },
    { key: 'spaces', label: 'Spaces with capacity & pricing', done: Boolean(v && count('SELECT COUNT(*) c FROM venue_spaces WHERE venue_id = ? AND active = 1', v.id)) },
    { key: 'facilities', label: 'Facilities', done: Boolean(v && parseJson(v.facilities, []).length) },
    { key: 'photos', label: 'Photos (at least 3)', done: Boolean(v && count('SELECT COUNT(*) c FROM venue_images WHERE venue_id = ?', v.id) >= 3) },
    { key: 'packages', label: 'Packages', done: Boolean(v && count('SELECT COUNT(*) c FROM venue_packages WHERE venue_id = ? AND active = 1', v.id)) },
    { key: 'bank', label: 'Bank details for payouts', done: Boolean(b.bank_account_enc && b.bank_ifsc) },
    { key: 'documents', label: 'Verification documents', done: docs.length >= 1 },
  ];
  res.json({ business: bizOut(b), venues, documents: docs, checklist, user: req.user });
});

r.post('/', (req, res) => {
  if (req.business) throw conflict('EXISTS', 'You already have a business profile');
  const b = req.body || {};
  const biz = {
    id: id('biz'),
    owner_user_id: req.user.id,
    type: oneOf(b.type || 'venue', 'Business type', BUSINESS_TYPES),
    name: str(b.name, 'Business name', { max: 120 }),
    owner_name: str(b.owner_name || req.user.name, 'Owner name', { max: 80 }),
    phone: normPhone(b.phone || req.user.phone),
    email: b.email || req.user.email,
    status: 'DRAFT',
    commission_bps: 1000,
    created_at: nowIso(),
  };
  if (biz.type !== 'venue') throw new HttpError(422, 'NOT_YET', 'Pandal is onboarding venues first. Catering, decoration and photography partners open soon — we have noted your interest.');
  insert('businesses', biz);
  insert('business_users', { business_id: biz.id, user_id: req.user.id, role: 'owner' });
  audit(req, 'business.create', 'business', biz.id, null, biz);
  res.status(201).json({ business: bizOut(biz) });
});

r.put('/profile', (req, res) => {
  const b = need(req);
  const x = req.body || {};
  const patch = {};
  if (x.name != null) patch.name = str(x.name, 'Business name', { max: 120 });
  if (x.legal_name != null) patch.legal_name = str(x.legal_name, 'Legal name', { max: 160, optional: true });
  if (x.owner_name != null) patch.owner_name = str(x.owner_name, 'Owner name', { max: 80 });
  if (x.phone != null) patch.phone = normPhone(x.phone);
  if (x.email != null) patch.email = str(x.email, 'Email', { max: 120 });
  if (x.gstin != null) {
    const g = String(x.gstin).trim().toUpperCase();
    if (g && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) throw bad('GSTIN format looks wrong (15 characters, e.g. 06ABCDE1234F1Z5)');
    patch.gstin = g || null;
  }
  if (x.pan != null && x.pan !== '') {
    const p = String(x.pan).trim().toUpperCase();
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(p)) throw bad('PAN format looks wrong');
    patch.pan_enc = encrypt(p);
  }
  for (const k of ['address', 'city', 'state']) if (x[k] != null) patch[k] = str(x[k], k, { max: 250, optional: true });
  if (x.pincode != null) {
    if (!/^\d{6}$/.test(String(x.pincode))) throw bad('Pincode must be 6 digits');
    patch.pincode = String(x.pincode);
  }
  if (x.bank_account != null && x.bank_account !== '') {
    const acc = String(x.bank_account).replace(/\s/g, '');
    if (!/^\d{9,18}$/.test(acc)) throw bad('Bank account number must be 9–18 digits');
    patch.bank_account_enc = encrypt(acc);
    patch.bank_account_last4 = acc.slice(-4);
  }
  if (x.bank_ifsc != null) {
    const ifsc = String(x.bank_ifsc).trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw bad('IFSC format looks wrong (e.g. HDFC0001234)');
    patch.bank_ifsc = ifsc;
  }
  if (x.bank_holder != null) patch.bank_holder = str(x.bank_holder, 'Account holder', { max: 120 });
  if (Object.keys(patch).length && ['APPROVED', 'SUSPENDED'].includes(b.status) && (patch.bank_account_enc || patch.gstin || patch.pan_enc)) {
    audit(req, 'business.sensitive_update', 'business', b.id, null, Object.keys(patch));
  }
  update('businesses', b.id, patch);
  audit(req, 'business.update', 'business', b.id, null, Object.keys(patch));
  res.json({ business: bizOut(q.get('SELECT * FROM businesses WHERE id = ?', b.id)) });
});

// Documents go to private storage and are only readable by admins.
r.post('/documents', (req, res) => {
  const b = need(req);
  const kind = oneOf(req.body?.kind, 'Document type', DOCUMENT_KINDS);
  const fileName = str(req.body?.file_name, 'File name', { max: 120 }).replace(/[^\w.\- ]/g, '_');
  const mime = oneOf(req.body?.mime, 'File type', ['application/pdf', 'image/jpeg', 'image/png']);
  const data = Buffer.from(String(req.body?.data_base64 || ''), 'base64');
  if (!data.length) throw bad('File is empty');
  if (data.length > 8 * 1024 * 1024) throw bad('Documents must be under 8 MB');
  const magic = data.subarray(0, 4).toString('hex');
  const okMagic = (mime === 'application/pdf' && magic.startsWith('25504446')) || (mime === 'image/png' && magic === '89504e47') || (mime === 'image/jpeg' && magic.startsWith('ffd8'));
  if (!okMagic) throw bad('File content does not match its type');
  const key = `${b.id}/${crypto.randomUUID()}`;
  const dir = path.join(config.storageDir, 'private', b.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(config.storageDir, 'private', key), data);
  const doc = { id: id('doc'), business_id: b.id, kind, file_name: fileName, mime, storage_key: key, status: 'PENDING', uploaded_at: nowIso() };
  insert('business_documents', doc);
  audit(req, 'business.document_upload', 'business', b.id, null, { kind, file_name: fileName });
  const { storage_key, ...pub } = doc;
  res.status(201).json(pub);
});

r.post('/submit', (req, res) => {
  const b = need(req);
  if (!['DRAFT', 'REJECTED'].includes(b.status)) throw conflict('INVALID_STATE', `Business is already ${b.status}`);
  const missing = [];
  if (!b.address || !b.pincode) missing.push('address');
  if (!b.bank_account_enc || !b.bank_ifsc) missing.push('bank details');
  if (!q.get('SELECT 1 FROM business_documents WHERE business_id = ?', b.id)) missing.push('documents');
  const venues = q.all("SELECT * FROM venues WHERE business_id = ? AND status IN ('DRAFT','SUBMITTED')", b.id);
  if (!venues.length) missing.push('a venue');
  for (const v of venues) {
    if (!v.lat || !v.lng) missing.push(`${v.name}: map location`);
    if (!q.get('SELECT 1 FROM venue_spaces WHERE venue_id = ? AND active = 1', v.id)) missing.push(`${v.name}: spaces`);
    if (!q.get('SELECT 1 FROM venue_packages WHERE venue_id = ? AND active = 1', v.id)) missing.push(`${v.name}: packages`);
  }
  if (missing.length) throw bad(`Please complete: ${missing.join(', ')}`, { missing });
  tx(() => {
    const now = nowIso();
    update('businesses', b.id, { status: 'SUBMITTED', submitted_at: now, rejection_reason: null });
    insert('verification_events', { id: id('ver'), entity_type: 'business', entity_id: b.id, from_status: b.status, to_status: 'SUBMITTED', actor_id: req.user.id, at: now });
    for (const v of venues) {
      if (v.status === 'DRAFT') {
        update('venues', v.id, { status: 'SUBMITTED', rejection_reason: null });
        insert('verification_events', { id: id('ver'), entity_type: 'venue', entity_id: v.id, from_status: 'DRAFT', to_status: 'SUBMITTED', actor_id: req.user.id, at: now });
      }
    }
  });
  audit(req, 'business.submit', 'business', b.id);
  res.json({ business: bizOut(q.get('SELECT * FROM businesses WHERE id = ?', b.id)) });
});

r.get('/verification', (req, res) => {
  const b = need(req);
  const venueIds = q.all('SELECT id FROM venues WHERE business_id = ?', b.id).map((v) => v.id);
  const events = q.all(
    `SELECT * FROM verification_events WHERE (entity_type = 'business' AND entity_id = ?) ${venueIds.length ? `OR (entity_type = 'venue' AND entity_id IN (${venueIds.map(() => '?').join(',')}))` : ''} ORDER BY at`,
    b.id, ...venueIds,
  );
  res.json({ status: b.status, rejection_reason: b.rejection_reason, events });
});

// ── Venues ──
function venueInput(x, partial) {
  const out = {};
  const set = (k, fn) => { if (!partial || x[k] !== undefined) out[k] = fn(x[k]); };
  set('name', (v) => str(v, 'Venue name', { max: 120 }));
  set('venue_type', (v) => oneOf(v, 'Venue type', VENUE_TYPES.map(([c]) => c)));
  set('description', (v) => str(v ?? '', 'Description', { min: 0, max: 4000, optional: true }) || '');
  set('address', (v) => str(v, 'Address', { max: 300, optional: true }));
  set('event_types', (v) => arrOf(v, 'Event types', q.all('SELECT code FROM event_categories').map((c) => c.code)));
  set('facilities', (v) => arrOf(v, 'Facilities', FACILITIES.map(([c]) => c)));
  set('parking_cars', (v) => int(v ?? 0, 'Parking capacity', { max: 5000 }));
  set('rooms', (v) => int(v ?? 0, 'Rooms', { max: 1000 }));
  set('advance_pct', (v) => int(v ?? 20, 'Advance %', { min: 5, max: 100 }));
  set('booking_mode', (v) => oneOf(v ?? 'instant', 'Booking mode', ['instant', 'request']));
  set('policies', (v) => (Array.isArray(v) ? v.map((p) => str(p, 'Policy', { max: 300 })).slice(0, 20) : []));
  if (x.cancellation_policy !== undefined) {
    const p = x.cancellation_policy;
    if (!Array.isArray(p) || !p.length) throw bad('Cancellation policy needs at least one rule');
    out.cancellation_policy = p.map((rule) => ({
      min_days: int(rule.min_days, 'Days before event', { max: 730 }),
      refund_pct: int(rule.refund_pct, 'Refund %', { max: 100 }),
      label: str(rule.label || `${rule.min_days}+ days before`, 'Label', { max: 60 }),
    })).sort((a, b) => b.min_days - a.min_days);
    if (!out.cancellation_policy.some((r) => r.min_days === 0)) throw bad('Add a rule for 0 days (cancellations close to the event)');
  }
  return out;
}

r.get('/venues', (req, res) => {
  const b = need(req);
  res.json({ items: q.all('SELECT * FROM venues WHERE business_id = ? ORDER BY created_at', b.id).map((v) => ({ ...v, event_types: parseJson(v.event_types, []), facilities: parseJson(v.facilities, []), policies: parseJson(v.policies, []), cancellation_policy: parseJson(v.cancellation_policy, []) })) });
});

r.post('/venues', (req, res) => {
  const b = need(req);
  const data = venueInput(req.body || {}, false);
  const v = {
    id: id('ven'),
    business_id: b.id,
    ...data,
    cancellation_policy: data.cancellation_policy || DEFAULT_CANCELLATION_POLICY,
    status: 'DRAFT',
    cover_hue: crypto.randomInt(0, 360),
    city: b.city,
    state: b.state,
    pincode: b.pincode,
    created_at: nowIso(),
  };
  insert('venues', v);
  audit(req, 'venue.create', 'venue', v.id, null, { name: v.name });
  res.status(201).json(venueDetail(q.get('SELECT * FROM venues WHERE id = ?', v.id)));
});

r.get('/venues/:id', (req, res) => {
  const v = ownVenue(req, req.params.id);
  const detail = venueDetail(v);
  // Owners also see inactive spaces/packages/services.
  detail.all_spaces = q.all('SELECT * FROM venue_spaces WHERE venue_id = ? ORDER BY sort', v.id).map((s) => ({ ...s, facilities: parseJson(s.facilities, []) }));
  detail.all_packages = q.all('SELECT * FROM venue_packages WHERE venue_id = ? ORDER BY sort', v.id).map((p) => ({ ...p, inclusions: parseJson(p.inclusions, []), cancellation_policy: parseJson(p.cancellation_policy, null) }));
  detail.all_services = q.all('SELECT * FROM services WHERE venue_id = ? ORDER BY sort', v.id);
  detail.status = v.status;
  detail.rejection_reason = v.rejection_reason;
  detail.booking_mode = v.booking_mode;
  res.json(detail);
});

r.put('/venues/:id', (req, res) => {
  const v = ownVenue(req, req.params.id);
  if (!EDITABLE_VENUE.includes(v.status)) throw conflict('LOCKED', `An ${v.status.toLowerCase()} venue cannot be edited`);
  const patch = venueInput(req.body || {}, true);
  update('venues', v.id, patch);
  audit(req, 'venue.update', 'venue', v.id, null, Object.keys(patch));
  res.json(venueDetail(q.get('SELECT * FROM venues WHERE id = ?', v.id)));
});

// Exact location: the owner drags a pin to the venue entrance. Moving the pin
// on a live venue resets location verification.
r.put('/venues/:id/location', (req, res) => {
  const v = ownVenue(req, req.params.id);
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 6 || lat > 37 || lng < 68 || lng > 98) throw bad('Pin must be inside India');
  const address = str(req.body?.address, 'Address', { max: 300 });
  const pincode = String(req.body?.pincode || '');
  if (!/^\d{6}$/.test(pincode)) throw bad('Pincode must be 6 digits');
  const na = nearestArea(lat, lng);
  const area = na && na.distanceKm <= na.area.radius_km * 2 ? na.area : null;
  const textHit = matchPlaces(`${req.body?.area || ''} ${req.body?.city || ''}`, { limit: 1 })[0];
  const moved = v.lat != null && (Math.abs(v.lat - lat) > 0.0005 || Math.abs(v.lng - lng) > 0.0005);
  const patch = {
    lat, lng, address, pincode,
    area_id: area?.id ?? null,
    area_name: str(req.body?.area, 'Area', { max: 80, optional: true }) || area?.name || null,
    city: str(req.body?.city, 'City', { max: 80, optional: true }) || area?.city_name || textHit?.city || null,
    state: str(req.body?.state, 'State', { max: 80, optional: true }) || area?.state || textHit?.state || null,
  };
  if (moved) patch.location_verified = 0;
  update('venues', v.id, patch);
  audit(req, 'venue.location', 'venue', v.id, { lat: v.lat, lng: v.lng }, { lat, lng });
  // Warn when the typed address and the pin disagree — the #1 cause of venues showing up kilometres away.
  const warnings = [];
  if (textHit && Math.hypot(textHit.lat - lat, textHit.lng - lng) > 0.05) warnings.push(`Your pin is about ${Math.round(Math.hypot(textHit.lat - lat, textHit.lng - lng) * 111)} km from ${textHit.label}. Please check the pin is on your entrance.`);
  res.json({ ok: true, location_verified: moved ? false : Boolean(v.location_verified), area: patch.area_name, warnings });
});

// ── Spaces ──
function spaceInput(x) {
  const seated = int(x.capacity_seated, 'Seated capacity', { min: 1, max: 20000 });
  const floating = int(x.capacity_floating ?? seated, 'Floating capacity', { min: 1, max: 30000 });
  if (floating < seated) throw bad('Floating capacity cannot be lower than seated capacity');
  const pm = int(x.price_morning, 'Morning price', { min: 0, max: 100_000_000 });
  const pe = int(x.price_evening, 'Evening price', { min: 0, max: 100_000_000 });
  const pf = int(x.price_full_day, 'Full-day price', { min: 0, max: 100_000_000 });
  if (pf < Math.max(pm, pe)) throw bad('Full-day price should be at least the higher of morning/evening');
  return {
    name: str(x.name, 'Space name', { max: 80 }),
    kind: oneOf(x.kind, 'Space type', ['indoor', 'outdoor', 'dining', 'rooftop', 'poolside']),
    capacity_seated: seated,
    capacity_floating: floating,
    min_guests: int(x.min_guests ?? 0, 'Minimum guests', { max: floating }),
    price_morning: pm,
    price_evening: pe,
    price_full_day: pf,
    weekend_surcharge_pct: int(x.weekend_surcharge_pct ?? 0, 'Weekend surcharge %', { max: 200 }),
    facilities: arrOf(x.facilities, 'Facilities', FACILITIES.map(([c]) => c)),
    description: str(x.description ?? '', 'Description', { min: 0, max: 1000, optional: true }) || '',
    active: x.active === false || x.active === 0 ? 0 : 1,
  };
}

r.post('/venues/:id/spaces', (req, res) => {
  const v = ownVenue(req, req.params.id);
  const s = { id: id('spc'), venue_id: v.id, ...spaceInput(req.body || {}), sort: q.get('SELECT COUNT(*) c FROM venue_spaces WHERE venue_id = ?', v.id).c };
  insert('venue_spaces', s);
  recomputeVenueAggregates(v.id);
  audit(req, 'space.create', 'venue_space', s.id, null, s);
  res.status(201).json(s);
});

r.put('/venues/:id/spaces/:sid', (req, res) => {
  const v = ownVenue(req, req.params.id);
  const s = q.get('SELECT * FROM venue_spaces WHERE id = ? AND venue_id = ?', req.params.sid, v.id);
  if (!s) throw notFound('Space');
  const patch = spaceInput({ ...s, facilities: parseJson(s.facilities, []), ...req.body });
  if (!patch.active && q.get("SELECT 1 FROM inventory_holds WHERE space_id = ? AND date >= ? AND kind IN ('BOOKING','OFFLINE','RESERVATION')", s.id, localToday())) {
    throw conflict('HAS_BOOKINGS', 'This space has upcoming bookings. Cancel or complete them before deactivating it.');
  }
  update('venue_spaces', s.id, patch);
  recomputeVenueAggregates(v.id);
  audit(req, 'space.update', 'venue_space', s.id, s, patch);
  res.json(q.get('SELECT * FROM venue_spaces WHERE id = ?', s.id));
});

// ── Packages ──
function packageInput(x) {
  const mode = oneOf(x.pricing_mode, 'Pricing mode', ['included', 'flat', 'per_plate']);
  return {
    name: str(x.name, 'Package name', { max: 80 }),
    tier: oneOf(x.tier || 'custom', 'Tier', ['essential', 'premium', 'luxury', 'custom']),
    pricing_mode: mode,
    price: mode === 'included' ? 0 : int(x.price, 'Price', { min: 1, max: 100_000_000 }),
    min_guests: int(x.min_guests ?? 0, 'Minimum guests', { max: 30000 }),
    inclusions: (Array.isArray(x.inclusions) ? x.inclusions : []).slice(0, 20).map((i) => ({
      code: oneOf(i.code, 'Inclusion', ['venue', 'catering', 'decoration', 'furniture', 'sound', 'lighting', 'parking', 'dj', 'photography', 'rooms', 'other']),
      label: str(i.label, 'Inclusion detail', { max: 120 }),
    })),
    description: str(x.description ?? '', 'Description', { min: 0, max: 1000, optional: true }) || '',
    active: x.active === false || x.active === 0 ? 0 : 1,
  };
}

r.post('/venues/:id/packages', (req, res) => {
  const v = ownVenue(req, req.params.id);
  const p = { id: id('pkg'), venue_id: v.id, ...packageInput(req.body || {}), sort: q.get('SELECT COUNT(*) c FROM venue_packages WHERE venue_id = ?', v.id).c };
  insert('venue_packages', p);
  audit(req, 'package.create', 'venue_package', p.id, null, p);
  res.status(201).json(p);
});

r.put('/venues/:id/packages/:pid', (req, res) => {
  const v = ownVenue(req, req.params.id);
  const p = q.get('SELECT * FROM venue_packages WHERE id = ? AND venue_id = ?', req.params.pid, v.id);
  if (!p) throw notFound('Package');
  const patch = packageInput({ ...p, inclusions: parseJson(p.inclusions, []), ...req.body });
  update('venue_packages', p.id, patch);
  audit(req, 'package.update', 'venue_package', p.id, p, patch);
  res.json(q.get('SELECT * FROM venue_packages WHERE id = ?', p.id));
});

// ── Add-on services ──
function serviceInput(x) {
  return {
    category: oneOf(x.category, 'Category', SERVICE_CATEGORIES),
    name: str(x.name, 'Service name', { max: 80 }),
    description: str(x.description ?? '', 'Description', { min: 0, max: 500, optional: true }) || '',
    pricing_mode: oneOf(x.pricing_mode, 'Pricing mode', ['flat', 'per_guest']),
    price: int(x.price, 'Price', { min: 1, max: 100_000_000 }),
    active: x.active === false || x.active === 0 ? 0 : 1,
  };
}

r.post('/venues/:id/services', (req, res) => {
  const v = ownVenue(req, req.params.id);
  const s = { id: id('svc'), venue_id: v.id, ...serviceInput(req.body || {}) };
  insert('services', s);
  audit(req, 'service.create', 'service', s.id, null, s);
  res.status(201).json(s);
});

r.put('/venues/:id/services/:sid', (req, res) => {
  const v = ownVenue(req, req.params.id);
  const s = q.get('SELECT * FROM services WHERE id = ? AND venue_id = ?', req.params.sid, v.id);
  if (!s) throw notFound('Service');
  const patch = serviceInput({ ...s, ...req.body });
  update('services', s.id, patch);
  res.json(q.get('SELECT * FROM services WHERE id = ?', s.id));
});

// ── Photos (public media) ──
r.post('/venues/:id/images', (req, res) => {
  const v = ownVenue(req, req.params.id);
  const category = oneOf(req.body?.category, 'Photo category', IMAGE_CATEGORIES);
  const mime = oneOf(req.body?.mime, 'Image type', ['image/jpeg', 'image/png', 'image/webp']);
  const data = Buffer.from(String(req.body?.data_base64 || ''), 'base64');
  if (!data.length || data.length > 6 * 1024 * 1024) throw bad('Photos must be between 1 byte and 6 MB');
  const hex = data.subarray(0, 12).toString('hex');
  const ok = (mime === 'image/png' && hex.startsWith('89504e47')) || (mime === 'image/jpeg' && hex.startsWith('ffd8')) || (mime === 'image/webp' && hex.startsWith('52494646') && hex.slice(16, 24) === '57454250');
  if (!ok) throw bad('File content is not a valid image');
  let spaceId = null;
  if (req.body?.space_id) {
    if (!q.get('SELECT 1 FROM venue_spaces WHERE id = ? AND venue_id = ?', req.body.space_id, v.id)) throw notFound('Space');
    spaceId = req.body.space_id;
  }
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
  const name = `${crypto.randomUUID()}.${ext}`;
  const dir = path.join(config.storageDir, 'public', 'venues', v.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), data);
  const img = { id: id('img'), venue_id: v.id, space_id: spaceId, category, media_type: 'photo', url: `${config.publicBaseUrl}/media/venues/${v.id}/${name}`, caption: str(req.body?.caption, 'Caption', { max: 120, optional: true }), sort: q.get('SELECT COUNT(*) c FROM venue_images WHERE venue_id = ?', v.id).c, created_at: nowIso() };
  insert('venue_images', img);
  res.status(201).json(img);
});

r.post('/venues/:id/videos', (req, res) => {
  const v = ownVenue(req, req.params.id);
  const url = str(req.body?.url, 'Video URL', { max: 400 });
  if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be|player\.vimeo\.com|vimeo\.com)\//.test(url)) throw bad('Use a YouTube or Vimeo link');
  const img = { id: id('img'), venue_id: v.id, category: oneOf(req.body?.category || 'exterior', 'Category', IMAGE_CATEGORIES), media_type: 'video', url, caption: str(req.body?.caption, 'Caption', { max: 120, optional: true }), sort: 999, created_at: nowIso() };
  insert('venue_images', img);
  res.status(201).json(img);
});

r.delete('/venues/:id/images/:imgId', (req, res) => {
  const v = ownVenue(req, req.params.id);
  const img = q.get('SELECT * FROM venue_images WHERE id = ? AND venue_id = ?', req.params.imgId, v.id);
  if (!img) throw notFound('Photo');
  q.run('DELETE FROM venue_images WHERE id = ?', img.id);
  const prefix = `${config.publicBaseUrl}/media/`;
  if (img.url.startsWith(prefix)) {
    const file = path.join(config.storageDir, 'public', img.url.slice(prefix.length));
    if (file.startsWith(path.join(config.storageDir, 'public'))) fs.rmSync(file, { force: true });
  }
  res.json({ ok: true });
});

// ── Calendar & inventory ──
r.get('/calendar', (req, res) => {
  const b = need(req);
  const month = String(req.query.month || localToday().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month must be YYYY-MM');
  const venueId = req.query.venue_id || q.get('SELECT id FROM venues WHERE business_id = ? ORDER BY created_at LIMIT 1', b.id)?.id;
  if (!venueId) return res.json({ month, spaces: [], days: [] });
  const v = ownVenue(req, venueId);
  const spaces = q.all('SELECT id, name, kind, capacity_floating FROM venue_spaces WHERE venue_id = ? AND active = 1 ORDER BY sort', v.id);
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`, to = `${month}-${String(last).padStart(2, '0')}`;
  const holds = spaces.length ? q.all(
    `SELECT h.id, h.space_id, h.date, h.unit, h.kind, h.group_id, h.note, h.expires_at, b.id AS booking_id, b.code, b.status, b.event_type, b.customer_name, b.guests, b.slot, b.source
       FROM inventory_holds h LEFT JOIN bookings b ON b.id = h.booking_id
      WHERE h.space_id IN (${spaces.map(() => '?').join(',')}) AND h.date BETWEEN ? AND ?
        AND NOT (h.kind = 'RESERVATION' AND h.expires_at < ?)`,
    ...spaces.map((s) => s.id), from, to, nowIso(),
  ) : [];
  const days = [];
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const dayHolds = holds.filter((h) => h.date === date);
    const perSpace = spaces.map((s) => {
      const am = dayHolds.find((h) => h.space_id === s.id && h.unit === 'AM');
      const pm = dayHolds.find((h) => h.space_id === s.id && h.unit === 'PM');
      const cell = (h) => (h ? { kind: h.kind, group_id: h.group_id, booking_id: h.booking_id, code: h.code, status: h.status, event_type: h.event_type, customer_name: h.customer_name, guests: h.guests, note: h.note, source: h.source } : null);
      return { space_id: s.id, AM: cell(am), PM: cell(pm) };
    });
    const taken = perSpace.reduce((a, s) => a + (s.AM ? 1 : 0) + (s.PM ? 1 : 0), 0);
    const total = spaces.length * 2;
    days.push({ date, past: date < localToday(), status: !total ? 'unavailable' : taken === 0 ? 'available' : taken === total ? 'booked' : 'partial', spaces: perSpace });
  }
  res.json({ venue_id: v.id, month, spaces, days });
});

r.post('/holds', (req, res) => {
  const b = need(req);
  const out = createBlock(b, actor(req), req.body || {});
  audit(req, 'inventory.block', 'venue_space', req.body?.space_id, null, req.body);
  res.status(201).json(out);
});

r.delete('/holds/:groupId', (req, res) => {
  const out = removeBlock(need(req), req.params.groupId);
  audit(req, 'inventory.unblock', 'hold_group', req.params.groupId);
  res.json(out);
});

r.post('/offline-bookings', (req, res) => {
  const b = need(req);
  const booking = createOfflineBooking(b, actor(req), req.body || {});
  audit(req, 'booking.offline_create', 'booking', booking.id, null, { code: booking.code, date: booking.event_date, slot: booking.slot });
  res.status(201).json(bookingOut(booking, 'business', { full: true }));
});

// ── Bookings ──
const TAB_FILTERS = {
  new: "status IN ('CONFIRMED') AND confirmed_at >= ? AND source = 'online'",
  pending: "status IN ('REQUESTED','PENDING_PAYMENT','PAYMENT_PROCESSING','PAYMENT_FAILED')",
  confirmed: "status IN ('CONFIRMED','UPCOMING')",
  upcoming: "status IN ('CONFIRMED','UPCOMING') AND event_date >= ?",
  completed: "status = 'COMPLETED'",
  cancelled: "status IN ('CANCELLED','REFUND_PROCESSING','REFUNDED','REJECTED','EXPIRED','CANCELLATION_REQUESTED')",
  offline: "source = 'offline'",
};

r.get('/bookings', (req, res) => {
  const b = need(req);
  const tab = req.query.tab && TAB_FILTERS[req.query.tab] ? req.query.tab : null;
  const params = [b.id];
  let where = 'business_id = ?';
  if (tab) {
    where += ` AND ${TAB_FILTERS[tab]}`;
    if (tab === 'new') params.push(new Date(Date.now() - 7 * 86_400_000).toISOString());
    if (tab === 'upcoming') params.push(localToday());
  }
  if (req.query.q) { where += ' AND (code LIKE ? OR customer_name LIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = q.all(`SELECT * FROM bookings WHERE ${where} ORDER BY ${tab === 'upcoming' ? 'event_date ASC' : 'created_at DESC'} LIMIT 200`, ...params);
  const counts = Object.fromEntries(Object.entries(TAB_FILTERS).map(([k, f]) => {
    const p = [b.id];
    if (k === 'new') p.push(new Date(Date.now() - 7 * 86_400_000).toISOString());
    if (k === 'upcoming') p.push(localToday());
    return [k, q.get(`SELECT COUNT(*) c FROM bookings WHERE business_id = ? AND ${f}`, ...p).c];
  }));
  res.json({ items: rows.map((x) => bookingOut(x, 'business')), counts });
});

r.get('/bookings/:id', (req, res) => {
  res.json(bookingOut(loadBookingFor({ role: 'business' }, req.params.id, need(req)), 'business', { full: true }));
});

r.post('/bookings/:id/accept', (req, res) => {
  const out = respondToRequest(need(req), actor(req), req.params.id, true);
  audit(req, 'booking.accept', 'booking', out.id);
  res.json(bookingOut(out, 'business', { full: true }));
});

r.post('/bookings/:id/reject', (req, res) => {
  const reason = str(req.body?.reason, 'Reason', { max: 300 });
  const out = respondToRequest(need(req), actor(req), req.params.id, false, reason);
  audit(req, 'booking.reject', 'booking', out.id, null, { reason });
  res.json(bookingOut(out, 'business', { full: true }));
});

r.post('/bookings/:id/complete', (req, res) => {
  const out = completeBooking(actor(req), req.params.id, need(req));
  audit(req, 'booking.complete', 'booking', out.id);
  res.json(bookingOut(out, 'business', { full: true }));
});

r.post('/bookings/:id/cancel', (req, res) => {
  const reason = str(req.body?.reason, 'Reason', { max: 300 });
  const out = cancelBooking(actor(req), req.params.id, { reason, by: 'business', business: need(req) });
  audit(req, 'booking.cancel_by_business', 'booking', out.id, null, { reason });
  res.json(bookingOut(out, 'business', { full: true }));
});

r.get('/bookings/:id/messages', (req, res) => {
  const bk = loadBookingFor({ role: 'business' }, req.params.id, need(req));
  res.json({ items: q.all('SELECT id, sender_role, body, at FROM messages WHERE booking_id = ? ORDER BY at', bk.id) });
});

r.post('/bookings/:id/messages', (req, res) => {
  const bk = loadBookingFor({ role: 'business' }, req.params.id, need(req));
  if (bk.source !== 'online') throw conflict('OFFLINE', 'Offline bookings have no in-app customer');
  const body = str(req.body?.body, 'Message', { max: 1000 });
  // Strip phone numbers so contact stays on-platform where required.
  const clean = body.replace(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g, '[number hidden]');
  const m = { id: id('msg'), booking_id: bk.id, sender_role: 'business', sender_id: req.user.id, body: clean, at: nowIso() };
  insert('messages', m);
  notifyUser(bk.customer_id, 'message', `Message from the venue (${bk.code})`, clean.slice(0, 120), { booking_id: bk.id });
  res.status(201).json(m);
});

// ── Dashboard, finance, reviews, notifications ──
r.get('/dashboard', (req, res) => {
  const b = need(req);
  const today = localToday();
  const one = (sql, ...p) => q.get(sql, b.id, ...p);
  const month = today.slice(0, 7);
  res.json({
    business: bizOut(b),
    today,
    new_bookings: one("SELECT COUNT(*) c FROM bookings WHERE business_id = ? AND status IN ('CONFIRMED','UPCOMING') AND source = 'online' AND confirmed_at >= ?", new Date(Date.now() - 86_400_000).toISOString()).c,
    upcoming: one("SELECT COUNT(*) c FROM bookings WHERE business_id = ? AND status IN ('CONFIRMED','UPCOMING') AND event_date >= ?", today).c,
    pending_requests: one("SELECT COUNT(*) c FROM bookings WHERE business_id = ? AND status = 'REQUESTED'").c,
    revenue_month: one("SELECT COALESCE(SUM(total),0) s FROM bookings WHERE business_id = ? AND status IN ('CONFIRMED','UPCOMING','COMPLETED') AND substr(event_date,1,7) = ?", month).s,
    collected_month: one("SELECT COALESCE(SUM(paid_amount - refunded_amount),0) s FROM bookings WHERE business_id = ? AND substr(confirmed_at,1,7) = ?", month).s,
    next_events: q.all("SELECT * FROM bookings WHERE business_id = ? AND status IN ('CONFIRMED','UPCOMING') AND event_date >= ? ORDER BY event_date LIMIT 6", b.id, today).map((x) => bookingOut(x, 'business')),
    week: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i);
      return { date, bookings: one("SELECT COUNT(*) c FROM bookings WHERE business_id = ? AND event_date = ? AND status IN ('CONFIRMED','UPCOMING')", date).c };
    }),
    rating: q.get('SELECT ROUND(AVG(rating_avg),1) a, SUM(rating_count) c FROM venues WHERE business_id = ?', b.id),
    unread_notifications: q.get('SELECT COUNT(*) c FROM notifications WHERE business_id = ? AND read_at IS NULL', b.id).c,
  });
});

r.get('/finance', (req, res) => {
  const b = need(req);
  res.json({
    summary: businessFinance(b.id),
    payouts: q.all('SELECT * FROM payouts WHERE business_id = ? ORDER BY created_at DESC LIMIT 50', b.id),
    ledger: q.all('SELECT txn_id, account, debit, credit, booking_id, ref_type, ref_id, memo, at FROM financial_ledger WHERE business_id = ? ORDER BY at DESC LIMIT 200', b.id),
    bookings: q.all("SELECT code, event_date, total, paid_amount, refunded_amount, commission_amount, business_payable, payout_status, status FROM bookings WHERE business_id = ? AND source = 'online' AND paid_amount > 0 ORDER BY event_date DESC LIMIT 200", b.id),
  });
});

r.get('/reviews', (req, res) => {
  const b = need(req);
  res.json({ items: q.all(`SELECT r.*, v.name AS venue_name, u.name AS customer_name, bk.code FROM reviews r JOIN venues v ON v.id = r.venue_id JOIN users u ON u.id = r.customer_id JOIN bookings bk ON bk.id = r.booking_id WHERE v.business_id = ? ORDER BY r.created_at DESC`, b.id) });
});

r.post('/reviews/:id/reply', (req, res) => {
  const b = need(req);
  const rv = q.get('SELECT r.id FROM reviews r JOIN venues v ON v.id = r.venue_id WHERE r.id = ? AND v.business_id = ?', req.params.id, b.id);
  if (!rv) throw notFound('Review');
  q.run('UPDATE reviews SET business_reply = ? WHERE id = ?', str(req.body?.reply, 'Reply', { max: 1000 }), rv.id);
  res.json({ ok: true });
});

r.get('/notifications', (req, res) => res.json(listFor({ businessId: need(req).id })));
r.post('/notifications/read', (req, res) => {
  markRead({ businessId: need(req).id, ids: Array.isArray(req.body?.ids) ? req.body.ids : null });
  res.json({ ok: true });
});

