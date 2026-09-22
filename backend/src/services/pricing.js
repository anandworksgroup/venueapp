// Server-side price calculation — the only place amounts are computed.
//
//   Venue (space × slot × weekend) + Package + Services  = Subtotal
//   − Coupon discount
//   + GST
//   = FINAL AMOUNT → Advance (venue's advance %) + Balance
//
// Clients send ids and counts, never prices. A tampered request can at most
// pick a different (real) package — never a different price.

import { q, parseJson, getSetting } from '../db/db.js';
import { SLOTS, DEFAULT_CANCELLATION_POLICY } from './catalog.js';
import { bad, notFound, conflict, int, isDate, weekday, localToday } from '../lib/util.js';

export const WEEKEND_DAYS = [5, 6, 0]; // Fri, Sat, Sun

export function spacePrice(space, slot, date) {
  const base = slot === 'MORNING' ? space.price_morning : slot === 'EVENING' ? space.price_evening : space.price_full_day;
  const weekend = date && WEEKEND_DAYS.includes(weekday(date)) && space.weekend_surcharge_pct > 0;
  const amount = weekend ? Math.round(base * (1 + space.weekend_surcharge_pct / 100)) : base;
  return { base, amount, weekend, surcharge_pct: weekend ? space.weekend_surcharge_pct : 0 };
}

export function validateCoupon(code, subtotal, today = localToday()) {
  if (!code) return null;
  const c = q.get('SELECT * FROM coupons WHERE code = ? AND active = 1', String(code).trim().toUpperCase());
  if (!c) throw bad('This coupon code is not valid');
  if ((c.valid_from && today < c.valid_from) || (c.valid_to && today > c.valid_to)) throw bad('This coupon has expired');
  if (subtotal < c.min_subtotal) throw bad(`This coupon needs a minimum booking value of ₹${c.min_subtotal.toLocaleString('en-IN')}`);
  let discount = c.kind === 'percent' ? Math.floor((subtotal * c.value) / 100) : c.value;
  if (c.max_discount) discount = Math.min(discount, c.max_discount);
  return { code: c.code, description: c.description, discount: Math.min(discount, subtotal) };
}

/**
 * @param {object} input  { venue_id, space_id, date, slot, guests, package_id, service_ids, coupon_code, event_type }
 * @param {object} opts   { allowUnpublished } — business offline bookings may price draft venues
 */
export function quote(input, opts = {}) {
  const venue = q.get('SELECT * FROM venues WHERE id = ?', input.venue_id);
  if (!venue) throw notFound('Venue');
  if (venue.status !== 'PUBLISHED' && !opts.allowUnpublished) throw conflict('VENUE_NOT_BOOKABLE', 'This venue is not accepting bookings right now');

  const space = q.get('SELECT * FROM venue_spaces WHERE id = ? AND venue_id = ?', input.space_id, venue.id);
  if (!space || !space.active) throw bad('Please choose a space at this venue');
  if (!isDate(input.date)) throw bad('Please choose a valid event date');
  if (input.date < localToday()) throw bad('Event date is in the past');
  if (!SLOTS[input.slot]) throw bad('Please choose a time slot');
  const guests = int(input.guests, 'Guests', { min: 1, max: 20000 });
  if (guests > space.capacity_floating) throw bad(`${space.name} holds up to ${space.capacity_floating} guests`);
  if (space.min_guests && guests < space.min_guests) throw bad(`${space.name} needs at least ${space.min_guests} guests`);

  const eventTypes = parseJson(venue.event_types, []);
  if (input.event_type && eventTypes.length && !eventTypes.includes(input.event_type)) {
    throw bad('This venue does not host this type of event');
  }

  const lines = [];
  const sp = spacePrice(space, input.slot, input.date);
  lines.push({
    kind: 'venue',
    ref_id: space.id,
    label: `Venue — ${space.name}`,
    detail: `${SLOTS[input.slot].label} (${SLOTS[input.slot].time})${sp.weekend ? ` · weekend +${sp.surcharge_pct}%` : ''}`,
    qty: 1,
    unit_price: sp.amount,
    amount: sp.amount,
  });

  let pkg = null;
  let included = [];
  if (input.package_id) {
    pkg = q.get('SELECT * FROM venue_packages WHERE id = ? AND venue_id = ? AND active = 1', input.package_id, venue.id);
    if (!pkg) throw bad('Please choose a package offered by this venue');
    if (pkg.min_guests && guests < pkg.min_guests && pkg.pricing_mode !== 'per_plate') {
      throw bad(`${pkg.name} is available for ${pkg.min_guests}+ guests`);
    }
    included = parseJson(pkg.inclusions, []);
    const plates = pkg.pricing_mode === 'per_plate' ? Math.max(guests, pkg.min_guests || 0) : 1;
    const amount = pkg.pricing_mode === 'included' ? 0 : pkg.pricing_mode === 'per_plate' ? pkg.price * plates : pkg.price;
    lines.push({
      kind: 'package',
      ref_id: pkg.id,
      label: `Package — ${pkg.name}`,
      detail: pkg.pricing_mode === 'per_plate'
        ? `₹${pkg.price.toLocaleString('en-IN')} × ${plates} plates${plates > guests ? ` (minimum ${pkg.min_guests})` : ''}`
        : pkg.pricing_mode === 'included' ? 'Included with venue rental' : 'Flat package price',
      qty: plates,
      unit_price: pkg.pricing_mode === 'included' ? 0 : pkg.price,
      amount,
    });
  }

  const serviceIds = [...new Set(input.service_ids || [])];
  for (const sid of serviceIds) {
    const s = q.get('SELECT * FROM services WHERE id = ? AND active = 1 AND (venue_id = ? OR venue_id IS NULL)', sid, venue.id);
    if (!s) throw bad('One of the selected services is not available at this venue');
    if (included.some((i) => i.code === s.category)) {
      throw bad(`${s.name} is already included in the ${pkg.name} package`);
    }
    const qty = s.pricing_mode === 'per_guest' ? guests : 1;
    lines.push({
      kind: 'service',
      ref_id: s.id,
      label: s.name,
      detail: s.pricing_mode === 'per_guest' ? `₹${s.price.toLocaleString('en-IN')} × ${guests} guests` : null,
      qty,
      unit_price: s.price,
      amount: s.price * qty,
    });
  }

  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const coupon = validateCoupon(input.coupon_code, subtotal);
  const discount = coupon?.discount || 0;
  if (coupon) lines.push({ kind: 'discount', ref_id: coupon.code, label: `Coupon ${coupon.code}`, detail: coupon.description, qty: 1, unit_price: -discount, amount: -discount });

  const taxRateBps = getSetting('tax_rate_bps', 1800);
  const tax = Math.round(((subtotal - discount) * taxRateBps) / 10_000);
  lines.push({ kind: 'tax', ref_id: null, label: `GST ${taxRateBps / 100}%`, detail: null, qty: 1, unit_price: tax, amount: tax });

  const total = subtotal - discount + tax;
  const advancePct = venue.advance_pct;
  const advance = Math.min(total, Math.ceil((total * advancePct) / 100));
  const policy = parseJson(pkg?.cancellation_policy, null) || parseJson(venue.cancellation_policy, null) || DEFAULT_CANCELLATION_POLICY;

  return {
    venue: { id: venue.id, name: venue.name, business_id: venue.business_id },
    space: { id: space.id, name: space.name },
    package: pkg ? { id: pkg.id, name: pkg.name } : null,
    event_type: input.event_type || null,
    date: input.date,
    slot: input.slot,
    slot_label: SLOTS[input.slot].label,
    slot_time: SLOTS[input.slot].time,
    guests,
    lines,
    subtotal,
    discount,
    coupon: coupon ? { code: coupon.code, description: coupon.description } : null,
    tax_rate_bps: taxRateBps,
    tax,
    total,
    advance_pct: advancePct,
    advance_amount: advance,
    balance_amount: total - advance,
    currency: 'INR',
    cancellation_policy: policy,
  };
}

/** Refund owed if a booking is cancelled today, from its snapshotted policy. */
export function cancellationQuote(booking, today = localToday()) {
  const policy = parseJson(booking.cancellation_policy, DEFAULT_CANCELLATION_POLICY)
    .slice()
    .sort((a, b) => b.min_days - a.min_days);
  const daysBefore = Math.round((new Date(`${booking.event_date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86_400_000);
  const rule = policy.find((r) => daysBefore >= r.min_days) || { min_days: 0, refund_pct: 0, label: 'No refund' };
  const refundable = booking.paid_amount - booking.refunded_amount;
  const refund = Math.floor((refundable * rule.refund_pct) / 100);
  return { days_before: daysBefore, rule, paid: booking.paid_amount, refund_amount: refund, retained_amount: refundable - refund, policy };
}
