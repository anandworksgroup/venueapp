// Public endpoints: browsing never requires an account (login happens at
// booking time), plus authentication.

import { Router } from 'express';
import crypto from 'node:crypto';
import { q, insert, update } from '../db/db.js';
import { config } from '../config.js';
import { rateLimit, audit } from '../lib/middleware.js';
import { hashPassword, verifyPassword, verifyTotp, signJwt, sha256 } from '../lib/security.js';
import { HttpError, bad, notFound, id, nowIso, normPhone, str, localToday } from '../lib/util.js';
import { reverseGeocode, searchPlaces } from '../services/location.js';
import { parseQuery } from '../services/queryParser.js';
import { searchVenues, rails } from '../services/search.js';
import { venueDetail, reviewOut } from '../services/venues.js';
import { venueMonth, venueDate } from '../services/availability.js';
import { quote } from '../services/pricing.js';
import { VENUE_TYPES, FACILITIES, SLOTS, GUEST_BUCKETS, BUDGET_OPTIONS, RADIUS_OPTIONS, SORTS, IMAGE_CATEGORIES, SERVICE_CATEGORIES, BUSINESS_TYPES, DOCUMENT_KINDS } from '../services/catalog.js';

export const publicRouter = Router();
const r = publicRouter;

const num = (v) => (v === undefined || v === '' ? null : Number(v));

r.get('/meta', (_req, res) => {
  res.json({
    event_categories: q.all('SELECT code, name, icon FROM event_categories WHERE active = 1 ORDER BY sort'),
    venue_types: VENUE_TYPES.map(([code, name]) => ({ code, name })),
    facilities: FACILITIES.map(([code, name]) => ({ code, name })),
    slots: Object.entries(SLOTS).map(([code, s]) => ({ code, ...s })),
    guest_buckets: GUEST_BUCKETS,
    budget_options: BUDGET_OPTIONS,
    radius_options_km: RADIUS_OPTIONS,
    sorts: SORTS.map(([code, name]) => ({ code, name })),
    image_categories: IMAGE_CATEGORIES,
    service_categories: SERVICE_CATEGORIES,
    business_types: BUSINESS_TYPES,
    document_kinds: DOCUMENT_KINDS,
    today: localToday(),
    currency: 'INR',
  });
});

// ── Location ──
r.get('/locations/reverse', rateLimit({ windowMs: 60_000, max: 60, name: 'geo' }), async (req, res) => {
  const lat = num(req.query.lat), lng = num(req.query.lng);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw bad('lat and lng are required');
  res.json(await reverseGeocode({ lat, lng, accuracyM: num(req.query.accuracy), provider: req.query.provider, timestamp: num(req.query.timestamp) }));
});

r.get('/locations/search', rateLimit({ windowMs: 60_000, max: 90, name: 'geo' }), async (req, res) => {
  res.json({ items: await searchPlaces(String(req.query.q || '')) });
});

r.get('/locations/popular', (_req, res) => {
  const rows = q.all(
    `SELECT a.id, a.name AS area, c.name AS city, c.state, a.pincode, a.lat, a.lng, COUNT(v.id) AS venues
       FROM areas a JOIN cities c ON c.id = a.city_id LEFT JOIN venues v ON v.area_id = a.id AND v.status = 'PUBLISHED'
      GROUP BY a.id HAVING venues > 0 ORDER BY venues DESC LIMIT 12`,
  );
  res.json({ items: rows.map((a) => ({ ...a, type: 'area', label: `${a.area}, ${a.city}` })), cities: q.all('SELECT * FROM cities') });
});

// ── Search ──
r.get('/search/parse', (req, res) => res.json(parseQuery(String(req.query.q || ''))));

r.get('/search/suggest', (req, res) => {
  const t = String(req.query.q || '').trim().toLowerCase();
  if (t.length < 2) return res.json({ venues: [], places: [], categories: [] });
  const like = `%${t}%`;
  res.json({
    venues: q.all("SELECT id, name, area_name AS area, city FROM venues WHERE status = 'PUBLISHED' AND lower(name) LIKE ? LIMIT 5", like),
    places: [],
    categories: q.all('SELECT code, name, icon FROM event_categories WHERE active = 1 AND lower(name) LIKE ? LIMIT 4', like),
    parsed: parseQuery(t),
  });
});

r.get('/venues', (req, res) => res.json(searchVenues(req.query)));

r.get('/discover/rails', (req, res) => {
  res.json({ rails: rails({ lat: num(req.query.lat), lng: num(req.query.lng), location_label: req.query.location_label }) });
});

function publishedVenue(venueId) {
  const v = q.get("SELECT * FROM venues WHERE id = ? AND status = 'PUBLISHED'", venueId);
  if (!v) throw notFound('Venue');
  return v;
}

r.get('/venues/:id', (req, res) => {
  const v = publishedVenue(req.params.id);
  res.json(venueDetail(v, { lat: num(req.query.lat), lng: num(req.query.lng), userId: req.user?.role === 'customer' ? req.user.id : null }));
});

r.get('/venues/:id/availability', (req, res) => {
  publishedVenue(req.params.id);
  const month = String(req.query.month || localToday().slice(0, 7));
  res.json(venueMonth(req.params.id, month, num(req.query.guests)));
});

r.get('/venues/:id/availability/:date', (req, res) => {
  publishedVenue(req.params.id);
  res.json(venueDate(req.params.id, req.params.date, num(req.query.guests)));
});

r.get('/venues/:id/reviews', (req, res) => {
  publishedVenue(req.params.id);
  const limit = Math.min(50, num(req.query.limit) || 20);
  const offset = Math.max(0, num(req.query.offset) || 0);
  const rows = q.all(
    `SELECT r.*, u.name AS customer_name, b.event_type FROM reviews r JOIN users u ON u.id = r.customer_id JOIN bookings b ON b.id = r.booking_id
      WHERE r.venue_id = ? AND r.status = 'PUBLISHED' ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    req.params.id, limit, offset,
  );
  res.json({ items: rows.map(reviewOut) });
});

// Price quote for the booking summary — computed only on the server.
r.post('/quote', (req, res) => {
  const b = req.body || {};
  res.json(quote({
    venue_id: b.venue_id,
    space_id: b.space_id,
    date: b.date,
    slot: b.slot,
    guests: b.guests,
    package_id: b.package_id || null,
    service_ids: Array.isArray(b.service_ids) ? b.service_ids : [],
    coupon_code: b.coupon_code || null,
    event_type: b.event_type || null,
  }));
});

// ── Auth ──
const tokenFor = (u) => signJwt({ sub: u.id, role: u.role }, u.role === 'admin' ? 8 * 3600 : 30 * 24 * 3600);
const userOut = (u) => ({ id: u.id, role: u.role, name: u.name, phone: u.phone, email: u.email, city: u.city, admin_role: u.admin_role || undefined });

// Customers sign in with phone + OTP at booking time.
const byPhone = (req) => String(req.body?.phone || '').replace(/\D/g, '').slice(-10);
r.post('/auth/otp/request',
  rateLimit({ windowMs: 10 * 60_000, max: 5, name: 'otp-phone', key: byPhone }),
  rateLimit({ windowMs: 10 * 60_000, max: 60, name: 'otp-ip' }),
  (req, res) => {
  const phone = normPhone(req.body?.phone);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  q.run(
    'INSERT INTO otp_codes (phone, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0) ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0',
    phone, sha256(`${phone}:${code}`), new Date(Date.now() + 5 * 60_000).toISOString(),
  );
  // Production: hand `code` to the SMS provider here. Never return it.
  res.json({ sent: true, phone, expires_in: 300, ...(config.exposeDevOtp ? { dev_otp: code } : {}) });
});

r.post('/auth/otp/verify', rateLimit({ windowMs: 10 * 60_000, max: 10, name: 'otp-verify', key: byPhone }), (req, res) => {
  const phone = normPhone(req.body?.phone);
  const code = String(req.body?.code || '');
  const row = q.get('SELECT * FROM otp_codes WHERE phone = ?', phone);
  if (!row || row.expires_at < nowIso()) throw new HttpError(400, 'OTP_EXPIRED', 'OTP expired. Please request a new one.');
  if (row.attempts >= 5) throw new HttpError(429, 'OTP_LOCKED', 'Too many attempts. Please request a new OTP.');
  if (sha256(`${phone}:${code}`) !== row.code_hash) {
    q.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?', phone);
    throw new HttpError(400, 'OTP_INVALID', 'Incorrect OTP');
  }
  q.run('DELETE FROM otp_codes WHERE phone = ?', phone);
  let user = q.get('SELECT * FROM users WHERE phone = ?', phone);
  if (user && user.role !== 'customer') throw new HttpError(409, 'ROLE_CONFLICT', 'This number belongs to a business or admin account. Please use the portal.');
  const isNew = !user;
  if (!user) {
    const name = req.body?.name ? str(req.body.name, 'Name', { max: 80 }) : null;
    user = { id: id('usr'), role: 'customer', phone, name, created_at: nowIso() };
    insert('users', user);
  }
  if (user.status === 'BLOCKED') throw new HttpError(403, 'BLOCKED', 'This account is blocked. Contact support.');
  update('users', user.id, { last_login_at: nowIso() });
  res.json({ token: tokenFor(user), user: userOut(q.get('SELECT * FROM users WHERE id = ?', user.id)), is_new: isNew });
});

// Businesses and admins sign in with email + password; admins also need TOTP.
r.post('/auth/login', rateLimit({ windowMs: 15 * 60_000, max: 10, name: 'login', key: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}` }), (req, res) => {
  const email = str(req.body?.email, 'Email', { max: 120 }).toLowerCase();
  const password = String(req.body?.password || '');
  const user = q.get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  if (user.status === 'BLOCKED') throw new HttpError(403, 'BLOCKED', 'This account is blocked');
  if (req.body?.portal && req.body.portal !== user.role) throw new HttpError(403, 'WRONG_PORTAL', `This is a ${user.role} account`);
  if (user.role === 'admin') {
    if (!req.body?.totp) throw new HttpError(401, 'TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator app');
    if (!verifyTotp(user.totp_secret, req.body.totp)) {
      audit({ user, ip: req.ip }, 'admin.login_failed_2fa', 'user', user.id);
      throw new HttpError(401, 'TOTP_INVALID', 'Authenticator code is incorrect');
    }
  }
  update('users', user.id, { last_login_at: nowIso() });
  if (user.role === 'admin') audit({ user, ip: req.ip }, 'admin.login', 'user', user.id);
  res.json({ token: tokenFor(user), user: userOut(user) });
});

r.post('/auth/register-business', rateLimit({ windowMs: 60 * 60_000, max: 5, name: 'register' }), (req, res) => {
  const b = req.body || {};
  const email = str(b.email, 'Email', { max: 120 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email');
  const password = str(b.password, 'Password', { min: 8, max: 128 });
  const name = str(b.name, 'Your name', { max: 80 });
  const phone = normPhone(b.phone);
  if (q.get('SELECT 1 FROM users WHERE email = ? OR phone = ?', email, phone)) throw new HttpError(409, 'EXISTS', 'An account with this email or phone already exists');
  const user = { id: id('usr'), role: 'business', name, email, phone, password_hash: hashPassword(password), created_at: nowIso() };
  insert('users', user);
  res.status(201).json({ token: tokenFor(user), user: userOut(user) });
});

r.get('/me', (req, res) => {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
  res.json({ user: userOut(q.get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

r.patch('/me', (req, res) => {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
  const patch = {};
  if (req.body?.name != null) patch.name = str(req.body.name, 'Name', { max: 80 });
  if (req.body?.email != null) {
    const email = str(req.body.email, 'Email', { max: 120 }).toLowerCase();
    if (q.get('SELECT 1 FROM users WHERE email = ? AND id != ?', email, req.user.id)) throw new HttpError(409, 'EXISTS', 'Email already in use');
    patch.email = email;
  }
  if (req.body?.city != null) patch.city = str(req.body.city, 'City', { max: 80, optional: true });
  update('users', req.user.id, patch);
  res.json({ user: userOut(q.get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});
