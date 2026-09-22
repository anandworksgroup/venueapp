// End-to-end tests for the rules the platform must never break:
// query understanding, real availability, server-side pricing, payment
// verification, double-booking prevention, refunds, ledger balance,
// business isolation and admin 2FA.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pandal-test-'));
const PORT = 4555;
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.STORAGE_DIR = path.join(tmp, 'storage');
process.env.PORT = String(PORT);
process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.GEOCODER = 'offline';

const { seed, DEV_ADMIN_TOTP_SECRET } = await import('../src/db/seed.js');
const { createApp } = await import('../src/server.js');
const { parseQuery } = await import('../src/services/queryParser.js');
const { totpNow } = await import('../src/lib/security.js');
const { localToday, addDays } = await import('../src/lib/util.js');
const { q } = await import('../src/db/db.js');

const BASE = `http://127.0.0.1:${PORT}`;
let server;
const today = localToday();
const year = today.slice(0, 4);
const SEP27 = `${year}-09-27` > today ? `${year}-09-27` : `${Number(year) + 1}-09-27`;

async function api(method, url, body, token, headers = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function customerToken(phone) {
  const r1 = await api('POST', '/api/v1/auth/otp/request', { phone });
  assert.equal(r1.status, 200);
  const r2 = await api('POST', '/api/v1/auth/otp/verify', { phone, code: r1.body.dev_otp, name: 'Test User' });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  return r2.body.token;
}

async function payAtGateway(orderId, outcome = 'success') {
  const res = await fetch(`${BASE}/gateway/checkout/${orderId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `outcome=${outcome}&method=upi`,
  });
  assert.equal(res.status, 200);
  const order = q.get('SELECT * FROM sandbox_gateway_orders WHERE order_id = ?', orderId);
  const { gateway } = await import('../src/services/gateway.js');
  return { order_id: orderId, payment_id: order.payment_id, signature: gateway.signCheckout(orderId, order.payment_id) };
}

before(async () => {
  seed({ quiet: true });
  server = createApp().listen(PORT);
  await new Promise((r) => server.once('listening', r));
});

after(() => {
  server?.close();
});

test('query understanding: the North Star sentence', () => {
  const p = parseQuery('Wedding hall near Faridabad for 500 people on 27 September under 2 lakh', { today });
  assert.equal(p.event, 'wedding');
  assert.equal(p.place.city, 'Faridabad');
  assert.equal(p.guests, 500);
  assert.equal(p.date, SEP27);
  assert.equal(p.budget_max, 200000);
  assert.equal(p.venue_type, 'banquet');
});

test('query understanding: sector names never become guest counts', () => {
  const p = parseQuery('Wedding venue near Sector 21 under 2 lakh', { today });
  assert.equal(p.event, 'wedding');
  assert.equal(p.place.area, 'Sector 21');
  assert.equal(p.budget_max, 200000);
  assert.equal(p.guests, null);
  const p2 = parseQuery('venues for 500 people', { today });
  assert.equal(p2.guests, 500);
  const p3 = parseQuery('birthday party in noida sector 18 this weekend 50k', { today });
  assert.equal(p3.event, 'birthday');
  assert.equal(p3.place.city, 'Noida');
  assert.equal(p3.budget_max, 50000);
  assert.ok(p3.date_from && p3.date_to);
});

test('location: precision matches GPS accuracy', async () => {
  const precise = await api('GET', '/api/v1/locations/reverse?lat=28.3947&lng=77.3255&accuracy=30');
  assert.equal(precise.body.confidence, 'precise');
  assert.equal(precise.body.area, 'Sector 15');
  const poor = await api('GET', '/api/v1/locations/reverse?lat=28.3947&lng=77.3255&accuracy=6000');
  assert.equal(poor.body.confidence, 'city');
  assert.equal(poor.body.area, null, 'must not claim an area from a 6 km fix');
  assert.equal(poor.body.label, 'Faridabad');
  const none = await api('GET', '/api/v1/locations/reverse?lat=28.3947&lng=77.3255');
  assert.equal(none.body.confidence, 'low');
  assert.ok(none.body.needs_confirmation);
});

test('search: North Star query finds Royal Garden with reasons', async () => {
  const r = await api('GET', `/api/v1/venues?q=${encodeURIComponent('Wedding hall near Faridabad for 500 people on 27 September under 2 lakh')}`);
  assert.equal(r.status, 200);
  const royal = r.body.items.find((v) => v.id === 'ven_royal');
  assert.ok(royal, 'Royal Garden should match');
  assert.ok(royal.match_reasons.some((m) => m.includes('500')));
  for (const v of r.body.items) {
    assert.ok(v.capacity_max >= 500);
    assert.ok(v.starting_price <= 200000);
    assert.ok(v.distance_km <= 30);
    assert.ok(v.event_types.includes('wedding'));
  }
});

test('availability: 27 Sep shows the lawn booked and the Grand Hall open', async () => {
  const r = await api('GET', `/api/v1/venues/ven_royal/availability/${SEP27}?guests=500`);
  const grand = r.body.spaces.find((s) => s.space_id === 'spc_grand');
  const lawn = r.body.spaces.find((s) => s.space_id === 'spc_lawn');
  assert.equal(grand.slots.find((s) => s.slot === 'EVENING').status, 'available');
  assert.equal(lawn.slots.find((s) => s.slot === 'EVENING').status, 'booked');
  assert.equal(lawn.slots.find((s) => s.slot === 'FULL_DAY').status, 'booked');
  const month = await api('GET', `/api/v1/venues/ven_royal/availability?month=${SEP27.slice(0, 7)}&guests=500`);
  const d = month.body.days.find((x) => x.date === SEP27);
  assert.ok(['available', 'limited'].includes(d.status));
});

test('pricing is server-side: the spec example totals ₹3,25,000 before GST', async () => {
  const r = await api('POST', '/api/v1/quote', {
    venue_id: 'ven_royal', space_id: 'spc_grand', date: SEP27, slot: 'EVENING', guests: 500,
    package_id: 'pkg_royal_prem', service_ids: ['svc_royal_cat'], event_type: 'wedding',
    // Tampering attempts — must be ignored:
    price: 1000, total: 1000, lines: [{ amount: 1 }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.subtotal, 325000);
  assert.equal(r.body.tax, 58500);
  assert.equal(r.body.total, 383500);
  assert.equal(r.body.advance_amount, 76700);
});

test('pricing rejects impossible combinations', async () => {
  const tooMany = await api('POST', '/api/v1/quote', { venue_id: 'ven_royal', space_id: 'spc_crystal', date: SEP27, slot: 'EVENING', guests: 500 });
  assert.equal(tooMany.status, 400);
  const foreignSpace = await api('POST', '/api/v1/quote', { venue_id: 'ven_royal', space_id: 'spc_sukh_orchard', date: SEP27, slot: 'EVENING', guests: 300 });
  assert.equal(foreignSpace.status, 400);
  const dupCatering = await api('POST', '/api/v1/quote', { venue_id: 'ven_royal', space_id: 'spc_grand', date: SEP27, slot: 'EVENING', guests: 300, package_id: 'pkg_royal_plate', service_ids: ['svc_royal_cat'] });
  assert.equal(dupCatering.status, 400, 'catering is already in the per-plate package');
});

let confirmedBookingId;

test('MVP journey: book → pay → forged signature rejected → verified → confirmed', async () => {
  const token = await customerToken('9000000001');
  const booking = await api('POST', '/api/v1/bookings', {
    venue_id: 'ven_royal', space_id: 'spc_grand', date: SEP27, slot: 'EVENING', guests: 500, event_type: 'wedding',
    package_id: 'pkg_royal_prem', service_ids: ['svc_royal_cat'], contact: { name: 'Test User', phone: '9000000001' },
  }, token, { 'Idempotency-Key': 'test-journey-1' });
  assert.equal(booking.status, 201, JSON.stringify(booking.body));
  assert.equal(booking.body.status, 'PENDING_PAYMENT');
  assert.equal(booking.body.total, 383500);
  assert.match(booking.body.code, /^EVT-\d{8}-\d{5}$/);

  // Same idempotency key → same booking, not a second hold.
  const again = await api('POST', '/api/v1/bookings', { venue_id: 'ven_royal', space_id: 'spc_grand', date: SEP27, slot: 'EVENING', guests: 500, event_type: 'wedding', contact: { name: 'Test User', phone: '9000000001' } }, token, { 'Idempotency-Key': 'test-journey-1' });
  assert.equal(again.body.id, booking.body.id);

  const pay = await api('POST', `/api/v1/bookings/${booking.body.id}/pay`, {}, token);
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal(pay.body.amount, 76700);

  // Frontend claims success without paying → must not confirm.
  const fake = await api('POST', '/api/v1/payments/verify', { order_id: pay.body.order_id, payment_id: 'gpay_fake', signature: 'deadbeef' }, token);
  assert.equal(fake.status, 400);
  const poll = await api('POST', '/api/v1/payments/verify', { order_id: pay.body.order_id }, token);
  assert.equal(poll.body.outcome, 'pending');

  const signed = await payAtGateway(pay.body.order_id);
  const ok = await api('POST', '/api/v1/payments/verify', signed, token);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.booking.status, 'CONFIRMED');
  assert.equal(ok.body.booking.paid_amount, 76700);
  assert.equal(ok.body.booking.balance_amount, 383500 - 76700);

  // Verification is idempotent (webhook + client may both arrive).
  const twice = await api('POST', '/api/v1/payments/verify', signed, token);
  assert.equal(twice.body.booking.paid_amount, 76700);
  confirmedBookingId = booking.body.id;

  const invoice = await fetch(`${BASE}/api/v1/bookings/${booking.body.id}/invoice?token=${token}`);
  assert.equal(invoice.status, 200);
  assert.match(await invoice.text(), /Invoice EVT-/);
});

test('no double booking: the confirmed slot cannot be booked again', async () => {
  const token = await customerToken('9000000002');
  const r = await api('POST', '/api/v1/bookings', { venue_id: 'ven_royal', space_id: 'spc_grand', date: SEP27, slot: 'FULL_DAY', guests: 400, event_type: 'wedding', contact: { name: 'Other', phone: '9000000002' } }, token);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'SLOT_UNAVAILABLE');
});

test('no double booking under concurrency: exactly one of 8 racing requests wins', async () => {
  const date = addDays(today, 150);
  const tokens = await Promise.all(Array.from({ length: 8 }, (_, i) => customerToken(`90000001${String(i).padStart(2, '0')}`)));
  const results = await Promise.all(tokens.map((t, i) => api('POST', '/api/v1/bookings', { venue_id: 'ven_royal', space_id: 'spc_crystal', date, slot: 'EVENING', guests: 100, event_type: 'birthday', contact: { name: 'Racer', phone: `90000001${String(i).padStart(2, '0')}` } }, t)));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 7);
  assert.equal(q.get("SELECT COUNT(*) c FROM inventory_holds WHERE space_id = 'spc_crystal' AND date = ? AND unit = 'PM'", date).c, 1);
});

test('failed payment keeps the hold; retry succeeds', async () => {
  const token = await customerToken('9000000003');
  const date = addDays(today, 160);
  const b = await api('POST', '/api/v1/bookings', { venue_id: 'ven_royal', space_id: 'spc_lawn', date, slot: 'MORNING', guests: 400, event_type: 'religious', contact: { name: 'Retry', phone: '9000000003' } }, token);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const p1 = await api('POST', `/api/v1/bookings/${b.body.id}/pay`, {}, token);
  const failed = await payAtGateway(p1.body.order_id, 'failure');
  const v1 = await api('POST', '/api/v1/payments/verify', failed, token);
  assert.equal(v1.body.outcome, 'failed');
  assert.equal(v1.body.booking.status, 'PAYMENT_FAILED');
  const p2 = await api('POST', `/api/v1/bookings/${b.body.id}/pay`, {}, token);
  assert.notEqual(p2.body.order_id, p1.body.order_id);
  const v2 = await api('POST', '/api/v1/payments/verify', await payAtGateway(p2.body.order_id), token);
  assert.equal(v2.body.booking.status, 'CONFIRMED');
});

test('webhook: bad signatures rejected, duplicates ignored', async () => {
  const bad = await fetch(`${BASE}/api/v1/payments/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Gateway-Signature': 'nope' }, body: '{"id":"evt_x"}' });
  assert.equal(bad.status, 401);
});

test('cancellation refunds per policy; admin processes refund; ledger stays balanced', async () => {
  const token = await customerToken('9000000001');
  const preview = await api('GET', `/api/v1/bookings/${confirmedBookingId}`, null, token);
  assert.ok(preview.body.cancellation.cancellable);
  const expectedRefund = preview.body.cancellation.refund_amount;
  const c = await api('POST', `/api/v1/bookings/${confirmedBookingId}/cancel`, { reason: 'Date changed' }, token);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.status, expectedRefund > 0 ? 'REFUND_PROCESSING' : 'CANCELLED');

  // Slot is free again.
  const avail = await api('GET', `/api/v1/venues/ven_royal/availability/${SEP27}`);
  assert.equal(avail.body.spaces.find((s) => s.space_id === 'spc_grand').slots.find((s) => s.slot === 'EVENING').status, 'available');

  const login = await api('POST', '/api/v1/auth/login', { email: 'finance@pandal.dev', password: 'Finance@12345', totp: totpNow(DEV_ADMIN_TOTP_SECRET) });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const refunds = await api('GET', '/api/v1/admin/refunds?status=PENDING', null, login.body.token);
  const rf = refunds.body.items.find((x) => x.booking_id === confirmedBookingId);
  if (expectedRefund > 0) {
    assert.equal(rf.amount, expectedRefund);
    const done = await api('POST', `/api/v1/admin/refunds/${rf.id}/process`, {}, login.body.token);
    assert.equal(done.body.status, 'PROCESSED');
    const b = await api('GET', `/api/v1/bookings/${confirmedBookingId}`, null, token);
    assert.equal(b.body.status, 'REFUNDED');
  }
  const ledger = await api('GET', '/api/v1/admin/ledger', null, login.body.token);
  assert.deepEqual(ledger.body.unbalanced_txns, []);
});

test('business isolation: another business cannot see Royal Garden bookings', async () => {
  const other = await api('POST', '/api/v1/auth/login', { email: 'partners@celebrations.in', password: 'Business@123' });
  const r = await api('GET', `/api/v1/business/bookings/${confirmedBookingId}`, null, other.body.token);
  assert.equal(r.status, 404);
  const own = await api('POST', '/api/v1/auth/login', { email: 'owner@royalgarden.in', password: 'Business@123' });
  const r2 = await api('GET', `/api/v1/business/bookings/${confirmedBookingId}`, null, own.body.token);
  assert.equal(r2.status, 200);
  assert.match(r2.body.customer_phone, /X{6}/, 'customer phone is masked for the business');
  const custOnBiz = await api('GET', '/api/v1/business/dashboard', null, await customerToken('9000000004'));
  assert.equal(custOnBiz.status, 403);
});

test('offline booking blocks online inventory', async () => {
  const own = await api('POST', '/api/v1/auth/login', { email: 'owner@royalgarden.in', password: 'Business@123' });
  const date = addDays(today, 170);
  const off = await api('POST', '/api/v1/business/offline-bookings', { space_id: 'spc_grand', date, slot: 'EVENING', customer_name: 'Rahul', customer_phone: '9876500000', source_channel: 'phone', event_type: 'wedding', guests: 300, amount: 150000 }, own.body.token);
  assert.equal(off.status, 201, JSON.stringify(off.body));
  const avail = await api('GET', `/api/v1/venues/ven_royal/availability/${date}`);
  assert.equal(avail.body.spaces.find((s) => s.space_id === 'spc_grand').slots.find((s) => s.slot === 'EVENING').status, 'booked');
  const other = await api('POST', '/api/v1/business/offline-bookings', { space_id: 'spc_grand', date, slot: 'FULL_DAY', customer_name: 'Dup' }, own.body.token);
  assert.equal(other.status, 409);
});

test('admin login requires a valid TOTP code and role permissions apply', async () => {
  const noCode = await api('POST', '/api/v1/auth/login', { email: 'admin@pandal.dev', password: 'Admin@12345' });
  assert.equal(noCode.body.error.code, 'TOTP_REQUIRED');
  const wrong = await api('POST', '/api/v1/auth/login', { email: 'admin@pandal.dev', password: 'Admin@12345', totp: '000000' });
  assert.equal(wrong.status, 401);
  const ops = await api('POST', '/api/v1/auth/login', { email: 'ops@pandal.dev', password: 'Ops@123456', totp: totpNow(DEV_ADMIN_TOTP_SECRET) });
  assert.equal(ops.status, 200);
  const payouts = await api('GET', '/api/v1/admin/payouts', null, ops.body.token);
  assert.equal(payouts.status, 403, 'ops cannot manage payouts');
  const verify = await api('GET', '/api/v1/admin/businesses?status=SUBMITTED', null, ops.body.token);
  assert.equal(verify.status, 200);
  assert.ok(verify.body.items.some((b) => b.id === 'biz_sukh'));
});

test('verification flow: a venue cannot be published before business approval and location check', async () => {
  const admin = await api('POST', '/api/v1/auth/login', { email: 'admin@pandal.dev', password: 'Admin@12345', totp: totpNow(DEV_ADMIN_TOTP_SECRET) });
  const t = admin.body.token;
  assert.equal((await api('POST', '/api/v1/admin/venues/ven_sukh/transition', { to: 'UNDER_REVIEW' }, t)).status, 200);
  assert.equal((await api('POST', '/api/v1/admin/venues/ven_sukh/transition', { to: 'APPROVED' }, t)).status, 200);
  const early = await api('POST', '/api/v1/admin/venues/ven_sukh/transition', { to: 'PUBLISHED' }, t);
  assert.equal(early.body.error.code, 'BUSINESS_NOT_APPROVED');
  for (const to of ['UNDER_REVIEW']) assert.equal((await api('POST', '/api/v1/admin/businesses/biz_sukh/transition', { to }, t)).status, 200);
  const docsFirst = await api('POST', '/api/v1/admin/businesses/biz_sukh/transition', { to: 'DOCUMENTS_VERIFIED' }, t);
  assert.equal(docsFirst.body.error.code, 'DOCS_PENDING');
  for (const d of ['doc_sukh_gst', 'doc_sukh_noc']) await api('POST', `/api/v1/admin/documents/${d}/review`, { status: 'VERIFIED' }, t);
  assert.equal((await api('POST', '/api/v1/admin/businesses/biz_sukh/transition', { to: 'DOCUMENTS_VERIFIED' }, t)).status, 200);
  assert.equal((await api('POST', '/api/v1/admin/businesses/biz_sukh/transition', { to: 'APPROVED' }, t)).status, 200);
  const noLoc = await api('POST', '/api/v1/admin/venues/ven_sukh/transition', { to: 'PUBLISHED' }, t);
  assert.equal(noLoc.body.error.code, 'LOCATION_UNVERIFIED');
  await api('POST', '/api/v1/admin/venues/ven_sukh/verify-location', {}, t);
  const pub = await api('POST', '/api/v1/admin/venues/ven_sukh/transition', { to: 'PUBLISHED' }, t);
  assert.equal(pub.status, 200);
  const live = await api('GET', '/api/v1/venues/ven_sukh');
  assert.equal(live.status, 200);
  const audit = await api('GET', '/api/v1/admin/audit-logs?entity_id=ven_sukh', null, t);
  assert.ok(audit.body.items.length >= 4);
});

test('reviews: only completed bookings, once', async () => {
  const token = await customerToken('9876543210');
  const list = await api('GET', '/api/v1/bookings', null, token);
  const done = list.body.past.find((b) => b.status === 'COMPLETED');
  const detail = await api('GET', `/api/v1/bookings/${done.id}`, null, token);
  if (detail.body.can_review) {
    const r1 = await api('POST', `/api/v1/bookings/${done.id}/review`, { overall: 5, food: 5, body: 'Lovely' }, token);
    assert.equal(r1.status, 201);
  }
  const r2 = await api('POST', `/api/v1/bookings/${done.id}/review`, { overall: 5 }, token);
  assert.equal(r2.status, 409);
  const upcoming = list.body.upcoming[0];
  if (upcoming) assert.equal((await api('POST', `/api/v1/bookings/${upcoming.id}/review`, { overall: 5 }, token)).status, 409);
});
