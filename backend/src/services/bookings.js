// Booking engine.
//
//   DRAFT → REQUESTED → PENDING_PAYMENT → PAYMENT_PROCESSING → CONFIRMED → UPCOMING → COMPLETED
//   REQUESTED → REJECTED
//   PENDING_PAYMENT → PAYMENT_FAILED → EXPIRED
//   CONFIRMED → CANCELLATION_REQUESTED → CANCELLED → REFUND_PROCESSING → REFUNDED
//
// A booking is confirmed only after the server has verified the payment with
// the gateway (signature + server-to-server order fetch + amount match).

import { q, tx, insert, update, parseJson, getSetting } from '../db/db.js';
import { quote, cancellationQuote } from './pricing.js';
import { claim, promoteToBooking, releaseBooking, bookingHoldsAlive, sweepExpired, isSlotFree } from './availability.js';
import { gateway } from './gateway.js';
import { postCapture, postRefund, recognise, computeCommission } from './finance.js';
import { notifyUser, notifyBusiness } from './notifications.js';
import { SLOTS } from './catalog.js';
import { config } from '../config.js';
import { HttpError, bad, conflict, forbidden, notFound, id, nowIso, localToday, addDays, str, normPhone, maskPhone, inr, oneOf, int } from '../lib/util.js';

export const TRANSITIONS = {
  DRAFT: ['REQUESTED', 'PENDING_PAYMENT', 'CONFIRMED'], // CONFIRMED only for owner-entered offline bookings
  REQUESTED: ['PENDING_PAYMENT', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  PENDING_PAYMENT: ['PAYMENT_PROCESSING', 'PAYMENT_FAILED', 'CONFIRMED', 'CANCELLED', 'EXPIRED'],
  PAYMENT_PROCESSING: ['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED', 'EXPIRED'],
  PAYMENT_FAILED: ['PAYMENT_PROCESSING', 'CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['UPCOMING', 'COMPLETED', 'CANCELLATION_REQUESTED'],
  UPCOMING: ['COMPLETED', 'CANCELLATION_REQUESTED'],
  CANCELLATION_REQUESTED: ['CANCELLED', 'CONFIRMED', 'UPCOMING'],
  CANCELLED: ['REFUND_PROCESSING'],
  REFUND_PROCESSING: ['REFUNDED'],
  EXPIRED: ['REFUND_PROCESSING'],
  COMPLETED: [],
  REJECTED: [],
  REFUNDED: [],
};

export const ACTIVE_STATUSES = ['REQUESTED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_FAILED', 'CONFIRMED', 'UPCOMING', 'CANCELLATION_REQUESTED'];
const PAYABLE = ['PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_FAILED'];

function transition(booking, to, actor, note, patch = {}) {
  if (booking.status !== to && !(TRANSITIONS[booking.status] || []).includes(to)) {
    throw conflict('INVALID_TRANSITION', `Booking cannot move from ${booking.status} to ${to}`);
  }
  update('bookings', booking.id, { status: to, ...patch });
  insert('booking_status_history', {
    id: id('bsh'),
    booking_id: booking.id,
    from_status: booking.status,
    to_status: to,
    actor_id: actor?.id ?? null,
    actor_role: actor?.role ?? 'system',
    note: note ?? null,
    at: nowIso(),
  });
  Object.assign(booking, { status: to, ...patch });
  return booking;
}

function nextCode(eventDate) {
  const day = eventDate.replaceAll('-', '');
  const row = q.get('SELECT next FROM booking_sequences WHERE day = ?', day);
  const n = row ? row.next : 1;
  q.run('INSERT INTO booking_sequences (day, next) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET next = excluded.next', day, n + 1);
  return `EVT-${day}-${String(n).padStart(5, '0')}`;
}

const checkoutUrl = (orderId) => `${config.publicBaseUrl}/gateway/checkout/${orderId}`;
const getBooking = (bookingId) => q.get('SELECT * FROM bookings WHERE id = ?', bookingId);

export function loadBookingFor(viewer, bookingId, business) {
  const b = getBooking(bookingId) || q.get('SELECT * FROM bookings WHERE code = ?', bookingId);
  if (!b) throw notFound('Booking');
  if (viewer.role === 'customer' && b.customer_id !== viewer.id) throw notFound('Booking');
  if (viewer.role === 'business' && b.business_id !== business?.id) throw notFound('Booking');
  return b;
}

// ─────────────────────────────── create ───────────────────────────────

export function createBooking(customer, input, idempotencyKey) {
  if (idempotencyKey) {
    const existing = q.get('SELECT * FROM bookings WHERE idempotency_key = ?', idempotencyKey);
    if (existing) {
      if (existing.customer_id !== customer.id) throw conflict('IDEMPOTENCY_CONFLICT', 'Idempotency key already used');
      return existing;
    }
  }
  const contact = input.contact || {};
  const contactName = str(contact.name || customer.name, 'Contact name', { max: 80 });
  const contactPhone = normPhone(contact.phone || customer.phone);
  const contactEmail = contact.email ? str(contact.email, 'Email', { max: 120 }) : customer.email || null;
  const eventType = str(input.event_type, 'Event type', { max: 40 });

  return tx(() => {
    const qt = quote({ ...input, event_type: eventType });
    const venue = q.get('SELECT * FROM venues WHERE id = ?', qt.venue.id);
    const business = q.get('SELECT commission_bps FROM businesses WHERE id = ?', venue.business_id);
    const requestMode = venue.booking_mode === 'request';
    const holdMinutes = requestMode ? 24 * 60 : getSetting('hold_minutes', 15);
    const expiresAt = new Date(Date.now() + holdMinutes * 60_000).toISOString();
    const bookingId = id('bkg');
    const now = nowIso();

    // Insert first (holds reference the booking), then claim inventory. If the
    // claim fails the whole transaction — booking row included — rolls back.
    insert('bookings', {
      id: bookingId,
      code: nextCode(qt.date),
      customer_id: customer.id,
      venue_id: venue.id,
      space_id: qt.space.id,
      business_id: venue.business_id,
      package_id: qt.package?.id ?? null,
      event_type: eventType,
      event_date: qt.date,
      slot: qt.slot,
      guests: qt.guests,
      status: 'DRAFT',
      source: 'online',
      customer_name: contactName,
      customer_phone: contactPhone,
      customer_email: contactEmail,
      notes: input.notes ? String(input.notes).slice(0, 1000) : null,
      coupon_code: qt.coupon?.code ?? null,
      subtotal: qt.subtotal,
      discount: qt.discount,
      tax: qt.tax,
      total: qt.total,
      advance_amount: qt.advance_amount,
      commission_bps: business.commission_bps,
      cancellation_policy: qt.cancellation_policy,
      idempotency_key: idempotencyKey || null,
      hold_expires_at: expiresAt,
      created_at: now,
    });
    claim({ spaceId: qt.space.id, date: qt.date, slot: qt.slot, kind: 'RESERVATION', bookingId, expiresAt, createdBy: customer.id });
    for (const l of qt.lines) {
      insert('booking_items', { id: id('bi'), booking_id: bookingId, kind: l.kind, ref_id: l.ref_id, label: l.label, detail: l.detail, qty: l.qty, unit_price: l.unit_price, amount: l.amount });
    }
    const b = getBooking(bookingId);
    const actor = { id: customer.id, role: 'customer' };
    if (requestMode) {
      transition(b, 'REQUESTED', actor, 'Booking request sent to venue');
      notifyUser(customer.id, 'booking_requested', 'Booking request sent', `${venue.name} will respond within 24 hours for ${qt.date}.`, { booking_id: b.id });
      notifyBusiness(venue.business_id, 'new_booking_request', 'New booking request', `${eventType} · ${qt.date} · ${qt.guests} guests · ${qt.space.name}`, { booking_id: b.id });
    } else {
      transition(b, 'PENDING_PAYMENT', actor, `Inventory held for ${holdMinutes} minutes`);
    }
    return b;
  });
}

// ─────────────────────────────── payment ───────────────────────────────

export function startPayment(customer, bookingId, { purpose = 'advance', returnUrl } = {}) {
  sweepExpired();
  const b = loadBookingFor(customer, bookingId);
  oneOf(purpose, 'purpose', ['advance', 'balance']);

  let amount;
  if (purpose === 'advance') {
    if (b.status === 'REQUESTED') throw conflict('AWAITING_VENUE', 'The venue has not accepted this request yet');
    if (!PAYABLE.includes(b.status)) throw conflict('NOT_PAYABLE', `This booking is ${b.status.toLowerCase().replace('_', ' ')}`);
    if (!bookingHoldsAlive(b.id)) throw conflict('HOLD_EXPIRED', 'Your reservation window expired. Please start the booking again.');
    amount = b.advance_amount - b.paid_amount;
  } else {
    if (!['CONFIRMED', 'UPCOMING'].includes(b.status)) throw conflict('NOT_PAYABLE', 'Balance can be paid only on a confirmed booking');
    amount = b.total - b.paid_amount;
  }
  if (amount <= 0) throw conflict('NOTHING_DUE', 'Nothing is due on this booking');

  return tx(() => {
    // Idempotent: reuse an open order for the same purpose and amount.
    const open = q.get("SELECT * FROM payments WHERE booking_id = ? AND purpose = ? AND amount = ? AND status IN ('CREATED','PROCESSING') ORDER BY created_at DESC LIMIT 1", b.id, purpose, amount);
    let payment = open && gateway.fetchOrder(open.gateway_order_id)?.status === 'created' ? open : null;
    if (!payment) {
      const order = gateway.createOrder({ amount, receipt: b.code, returnUrl });
      payment = { id: id('pay'), booking_id: b.id, purpose, amount, currency: 'INR', status: 'CREATED', gateway: gateway.name, gateway_order_id: order.order_id, created_at: nowIso() };
      insert('payments', payment);
    } else if (returnUrl) {
      q.run('UPDATE sandbox_gateway_orders SET return_url = ? WHERE order_id = ?', returnUrl, payment.gateway_order_id);
    }
    if (purpose === 'advance') {
      // Give the customer time at the gateway, but never an unbounded hold.
      const cap = new Date(new Date(b.created_at).getTime() + 60 * 60_000).toISOString();
      const extended = new Date(Date.now() + 10 * 60_000).toISOString();
      const newExpiry = [b.hold_expires_at, extended < cap ? extended : cap].sort().pop();
      q.run("UPDATE inventory_holds SET expires_at = ? WHERE booking_id = ? AND kind = 'RESERVATION'", newExpiry, b.id);
      q.run('UPDATE bookings SET hold_expires_at = ? WHERE id = ?', newExpiry, b.id);
      if (b.status !== 'PAYMENT_PROCESSING') transition(b, 'PAYMENT_PROCESSING', { id: customer.id, role: 'customer' }, `Checkout started for ${inr(amount)}`);
    }
    return {
      payment_id: payment.id,
      gateway: payment.gateway,
      order_id: payment.gateway_order_id,
      amount,
      currency: 'INR',
      purpose,
      checkout_url: checkoutUrl(payment.gateway_order_id),
      hold_expires_at: getBooking(b.id).hold_expires_at,
    };
  });
}

function autoRefund(b, payment, reason) {
  const refund = { id: id('rf'), booking_id: b.id, payment_id: payment.id, amount: payment.amount, status: 'PENDING', reason, policy_rule: 'Full refund — booking could not be confirmed', created_at: nowIso() };
  insert('refunds', refund);
  return processRefundInternal(refund.id, null);
}

/**
 * Verify a payment and, if genuine, confirm the booking.
 * via = 'client'  → signature from the checkout redirect must verify
 * via = 'webhook' → caller already verified the webhook HMAC
 * Either way the order is re-fetched from the gateway and the amount checked.
 * Safe to call any number of times (idempotent on the payment row).
 */
export function verifyAndCapture({ orderId, paymentId, signature }, via = 'client') {
  const payment = q.get('SELECT * FROM payments WHERE gateway_order_id = ?', orderId);
  if (!payment) throw notFound('Payment');
  const b0 = getBooking(payment.booking_id);

  if (payment.status === 'CAPTURED') {
    if (paymentId && payment.gateway_payment_id !== paymentId) throw bad('Payment id does not match this order');
    return { outcome: 'captured', booking: b0, payment, idempotent: true };
  }
  if (via === 'client' && !gateway.verifyCheckoutSignature(orderId, paymentId, signature)) {
    throw new HttpError(400, 'SIGNATURE_INVALID', 'Payment could not be verified');
  }

  const remote = gateway.fetchOrder(orderId);
  if (!remote) throw bad('Unknown gateway order');
  if (remote.status === 'failed') {
    tx(() => {
      q.run("UPDATE payments SET status = 'FAILED', gateway_payment_id = COALESCE(gateway_payment_id, ?), failure_reason = ? WHERE id = ? AND status != 'CAPTURED'", remote.payment_id, 'Declined at gateway', payment.id);
      const b = getBooking(payment.booking_id);
      if (b.status === 'PAYMENT_PROCESSING' || b.status === 'PENDING_PAYMENT') {
        transition(b, 'PAYMENT_FAILED', null, 'Gateway reported failure');
        notifyUser(b.customer_id, 'payment_failed', 'Payment failed', `Your payment of ${inr(payment.amount)} for ${b.code} did not go through. Your slot is held until ${new Date(b.hold_expires_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}.`, { booking_id: b.id });
      }
    });
    return { outcome: 'failed', booking: getBooking(payment.booking_id), payment: q.get('SELECT * FROM payments WHERE id = ?', payment.id) };
  }
  if (remote.status !== 'paid') return { outcome: 'pending', booking: b0, payment };
  if (via === 'client' && remote.payment_id !== paymentId) throw new HttpError(400, 'SIGNATURE_INVALID', 'Payment could not be verified');
  if (remote.amount !== payment.amount) {
    q.run("UPDATE payments SET status = 'FAILED', failure_reason = 'Amount mismatch' WHERE id = ?", payment.id);
    throw new HttpError(400, 'AMOUNT_MISMATCH', 'Paid amount does not match the booking amount');
  }

  return tx(() => {
    const fresh = q.get('SELECT * FROM payments WHERE id = ?', payment.id);
    if (fresh.status === 'CAPTURED') return { outcome: 'captured', booking: getBooking(fresh.booking_id), payment: fresh, idempotent: true };
    const now = nowIso();
    q.run("UPDATE payments SET status = 'CAPTURED', gateway_payment_id = ?, method = ?, verified_at = ? WHERE id = ?", remote.payment_id, remote.method, now, payment.id);
    const captured = q.get('SELECT * FROM payments WHERE id = ?', payment.id);
    const b = getBooking(payment.booking_id);
    q.run('UPDATE bookings SET paid_amount = paid_amount + ? WHERE id = ?', payment.amount, b.id);
    b.paid_amount += payment.amount;
    postCapture(captured, b);

    if (payment.purpose === 'balance') {
      const { commission, payable } = computeCommission(b);
      q.run('UPDATE bookings SET commission_amount = ?, business_payable = ? WHERE id = ?', commission, payable, b.id);
      notifyUser(b.customer_id, 'payment_received', 'Balance payment received', `${inr(payment.amount)} received for ${b.code}.`, { booking_id: b.id });
      notifyBusiness(b.business_id, 'payment_received', 'Balance payment received', `${inr(payment.amount)} for ${b.code} (${b.event_date}).`, { booking_id: b.id });
      return { outcome: 'captured', booking: getBooking(b.id), payment: captured };
    }

    // Advance: the inventory must still be ours.
    let secured = PAYABLE.includes(b.status) && bookingHoldsAlive(b.id);
    if (!secured && ['PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_FAILED', 'EXPIRED'].includes(b.status)) {
      // Hold lapsed while the customer was at the gateway: re-claim if still free.
      releaseBooking(b.id);
      if (isSlotFree(b.space_id, b.event_date, b.slot)) {
        claim({ spaceId: b.space_id, date: b.event_date, slot: b.slot, kind: 'BOOKING', bookingId: b.id });
        if (b.status === 'EXPIRED') {
          // EXPIRED is terminal for customers; revive explicitly with an audit note.
          update('bookings', b.id, { status: 'PAYMENT_PROCESSING' });
          insert('booking_status_history', { id: id('bsh'), booking_id: b.id, from_status: 'EXPIRED', to_status: 'PAYMENT_PROCESSING', actor_role: 'system', note: 'Late payment captured; slot still free — re-secured', at: now });
          b.status = 'PAYMENT_PROCESSING';
        }
        secured = true;
      }
    }
    if (!secured) {
      if (b.status !== 'EXPIRED' && b.status !== 'CANCELLED') transition(b, 'EXPIRED', null, 'Payment arrived after the slot was released');
      transition(b, 'REFUND_PROCESSING', null, 'Automatic full refund');
      autoRefund(getBooking(b.id), captured, 'Slot no longer available when payment completed');
      notifyUser(b.customer_id, 'booking_cancelled', 'Booking could not be confirmed', `Your payment for ${b.code} arrived after the slot was released. A full refund of ${inr(payment.amount)} has been issued.`, { booking_id: b.id });
      return { outcome: 'refunded', booking: getBooking(b.id), payment: captured };
    }

    promoteToBooking(b.id);
    const { commission, payable } = computeCommission(b);
    transition(b, 'CONFIRMED', null, `Payment ${captured.id} verified with gateway (${via})`, {
      confirmed_at: now,
      commission_amount: commission,
      business_payable: payable,
      hold_expires_at: null,
    });
    q.run('UPDATE venues SET booking_count = booking_count + 1 WHERE id = ?', b.venue_id);
    const venue = q.get('SELECT name FROM venues WHERE id = ?', b.venue_id);
    notifyUser(b.customer_id, 'payment_received', 'Payment received', `${inr(payment.amount)} paid for ${b.code}.`, { booking_id: b.id });
    notifyUser(b.customer_id, 'booking_confirmed', 'Booking confirmed', `${venue.name} · ${b.event_date} · ${SLOTS[b.slot].label}. Booking ID ${b.code}.`, { booking_id: b.id });
    notifyBusiness(b.business_id, 'new_booking', 'New booking', `${b.event_type} · ${b.event_date} · ${b.guests} guests · advance ${inr(payment.amount)} paid`, { booking_id: b.id });
    notifyBusiness(b.business_id, 'payment_received', 'Advance received', `${inr(payment.amount)} for ${b.code}.`, { booking_id: b.id });
    return { outcome: 'captured', booking: getBooking(b.id), payment: captured };
  });
}

// ─────────────────────────────── request mode ───────────────────────────────

export function respondToRequest(business, actor, bookingId, accept, reason) {
  return tx(() => {
    const b = loadBookingFor({ role: 'business' }, bookingId, business);
    if (b.status !== 'REQUESTED') throw conflict('INVALID_TRANSITION', 'Only pending requests can be accepted or declined');
    if (accept) {
      const expires = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
      q.run("UPDATE inventory_holds SET expires_at = ? WHERE booking_id = ? AND kind = 'RESERVATION'", expires, b.id);
      transition(b, 'PENDING_PAYMENT', actor, 'Accepted by venue; 24 hours to pay the advance', { hold_expires_at: expires });
      notifyUser(b.customer_id, 'booking_accepted', 'Your request was accepted', `Pay ${inr(b.advance_amount)} within 24 hours to confirm ${b.code}.`, { booking_id: b.id });
    } else {
      releaseBooking(b.id);
      transition(b, 'REJECTED', actor, reason || 'Declined by venue', { cancel_reason: reason || null });
      notifyUser(b.customer_id, 'booking_rejected', 'Request declined', `The venue could not accept ${b.code}${reason ? `: ${reason}` : '.'}`, { booking_id: b.id });
    }
    return getBooking(b.id);
  });
}

// ─────────────────────────────── cancellation & refunds ───────────────────────────────

export function cancellationPreview(b) {
  if (['CONFIRMED', 'UPCOMING'].includes(b.status)) return { cancellable: b.event_date >= localToday(), ...cancellationQuote(b) };
  if (['REQUESTED', 'PENDING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_PROCESSING'].includes(b.status)) {
    return { cancellable: true, days_before: null, rule: null, paid: b.paid_amount, refund_amount: 0, retained_amount: 0, policy: parseJson(b.cancellation_policy, []) };
  }
  return { cancellable: false };
}

/**
 * by: 'customer' (policy refund) | 'business' (full refund: venue cancelled) |
 *     'admin' (refund_amount override allowed)
 */
export function cancelBooking(actor, bookingId, { reason, by, refundOverride, business } = {}) {
  return tx(() => {
    const b = loadBookingFor(actor.role === 'admin' ? { role: 'admin' } : actor, bookingId, business);
    const now = nowIso();
    if (['REQUESTED', 'PENDING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_PROCESSING'].includes(b.status)) {
      releaseBooking(b.id);
      transition(b, 'CANCELLED', actor, reason || 'Cancelled before payment', { cancelled_at: now, cancel_reason: reason || null });
      q.run("UPDATE payments SET status = 'EXPIRED' WHERE booking_id = ? AND status IN ('CREATED','PROCESSING')", b.id);
      return getBooking(b.id);
    }
    if (!['CONFIRMED', 'UPCOMING'].includes(b.status)) throw conflict('NOT_CANCELLABLE', `A ${b.status.toLowerCase()} booking cannot be cancelled`);
    if (b.event_date < localToday()) throw conflict('NOT_CANCELLABLE', 'This event date has passed');

    let refund;
    let ruleLabel;
    const refundable = b.paid_amount - b.refunded_amount;
    if (by === 'business') { refund = refundable; ruleLabel = 'Venue cancelled — full refund'; }
    else if (by === 'admin' && refundOverride != null) { refund = Math.min(refundable, int(refundOverride, 'refund_amount', { min: 0 })); ruleLabel = 'Admin decision'; }
    else {
      const cq = cancellationQuote(b);
      refund = cq.refund_amount;
      ruleLabel = `${cq.rule.label}: ${cq.rule.refund_pct}% refund`;
    }

    transition(b, 'CANCELLATION_REQUESTED', actor, reason || null);
    releaseBooking(b.id);
    transition(b, 'CANCELLED', actor, ruleLabel, { cancelled_at: now, cancel_reason: reason || null });
    const venue = q.get('SELECT name FROM venues WHERE id = ?', b.venue_id);

    if (b.source === 'offline') return getBooking(b.id);

    if (refund > 0) {
      const pay = q.get("SELECT id FROM payments WHERE booking_id = ? AND status = 'CAPTURED' ORDER BY created_at LIMIT 1", b.id);
      insert('refunds', { id: id('rf'), booking_id: b.id, payment_id: pay?.id ?? null, amount: refund, status: 'PENDING', reason: reason || null, policy_rule: ruleLabel, created_at: now });
      transition(b, 'REFUND_PROCESSING', null, `Refund of ${inr(refund)} initiated`);
    } else {
      recognise(getBooking(b.id));
    }
    notifyUser(b.customer_id, 'booking_cancelled', 'Booking cancelled', `${b.code} at ${venue.name} is cancelled. ${refund > 0 ? `Refund of ${inr(refund)} is being processed.` : 'No refund applies under the cancellation policy.'}`, { booking_id: b.id });
    if (by !== 'business') notifyBusiness(b.business_id, 'cancellation', 'Booking cancelled', `${b.code} (${b.event_date}) was cancelled by the ${by}. The slot is open again.`, { booking_id: b.id });
    return getBooking(b.id);
  });
}

function processRefundInternal(refundId, actor) {
  const r = q.get('SELECT * FROM refunds WHERE id = ?', refundId);
  if (!r) throw notFound('Refund');
  if (r.status === 'PROCESSED') return r;
  if (r.status !== 'PENDING' && r.status !== 'FAILED') throw conflict('INVALID_STATE', `Refund is ${r.status}`);
  const pay = r.payment_id ? q.get('SELECT * FROM payments WHERE id = ?', r.payment_id) : null;
  const res = gateway.refund(pay?.gateway_payment_id, r.amount);
  const now = nowIso();
  q.run("UPDATE refunds SET status = 'PROCESSED', gateway_refund_id = ?, processed_at = ? WHERE id = ?", res.refund_id, now, r.id);
  q.run('UPDATE bookings SET refunded_amount = refunded_amount + ? WHERE id = ?', r.amount, r.booking_id);
  const b = getBooking(r.booking_id);
  postRefund({ ...r, status: 'PROCESSED' }, b);
  const pending = q.get("SELECT COUNT(*) c FROM refunds WHERE booking_id = ? AND status IN ('PENDING','PROCESSING')", b.id).c;
  if (!pending && b.status === 'REFUND_PROCESSING') {
    transition(b, 'REFUNDED', actor, `Refund ${res.refund_id} processed`);
    recognise(getBooking(b.id));
  }
  notifyUser(b.customer_id, 'refund_processed', 'Refund processed', `${inr(r.amount)} for ${b.code} is on its way to your original payment method (5–7 working days).`, { booking_id: b.id });
  return q.get('SELECT * FROM refunds WHERE id = ?', r.id);
}

export const processRefund = (refundId, actor) => tx(() => processRefundInternal(refundId, actor));

// ─────────────────────────────── completion ───────────────────────────────

export function completeBooking(actor, bookingId, business) {
  return tx(() => {
    const b = loadBookingFor(actor.role === 'business' ? actor : { role: 'admin' }, bookingId, business);
    if (!['CONFIRMED', 'UPCOMING'].includes(b.status)) throw conflict('INVALID_TRANSITION', 'Only confirmed bookings can be completed');
    if (b.event_date > localToday()) throw conflict('TOO_EARLY', 'An event can be marked completed on or after its date');
    return completeInternal(b, actor);
  });
}

function completeInternal(b, actor) {
  transition(b, 'COMPLETED', actor, actor ? 'Marked completed' : 'Auto-completed after event date', { completed_at: nowIso() });
  if (b.source === 'online') {
    recognise(getBooking(b.id));
    const venue = q.get('SELECT name FROM venues WHERE id = ?', b.venue_id);
    notifyUser(b.customer_id, 'review_reminder', 'How was your event?', `Rate ${venue.name} — your review helps other families and teams choose.`, { booking_id: b.id, venue_id: b.venue_id });
    q.run('UPDATE bookings SET review_reminder_sent = 1 WHERE id = ?', b.id);
  }
  return getBooking(b.id);
}

// ─────────────────────────────── offline bookings & blocks ───────────────────────────────

export function createOfflineBooking(business, actor, input) {
  const space = q.get(
    'SELECT s.*, v.business_id, v.id AS vid FROM venue_spaces s JOIN venues v ON v.id = s.venue_id WHERE s.id = ?',
    input.space_id,
  );
  if (!space || space.business_id !== business.id) throw notFound('Space');
  const date = input.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw bad('Please choose a date');
  oneOf(input.slot, 'Slot', Object.keys(SLOTS));
  const name = str(input.customer_name, 'Customer name', { max: 80 });
  const phone = input.customer_phone ? normPhone(input.customer_phone) : null;
  const channel = oneOf(input.source_channel || 'phone', 'Source', ['phone', 'walk_in', 'whatsapp', 'existing_customer', 'other']);
  const guests = int(input.guests ?? 0, 'Guests', { min: 0, max: 20000 });
  const amount = int(input.amount ?? 0, 'Amount', { min: 0, max: 100_000_000 });

  return tx(() => {
    const bookingId = id('bkg');
    const now = nowIso();
    insert('bookings', {
      id: bookingId,
      code: nextCode(date),
      customer_id: null,
      venue_id: space.vid,
      space_id: space.id,
      business_id: business.id,
      event_type: input.event_type || 'other',
      event_date: date,
      slot: input.slot,
      guests,
      status: 'DRAFT',
      source: 'offline',
      source_channel: channel,
      customer_name: name,
      customer_phone: phone,
      notes: input.notes ? String(input.notes).slice(0, 1000) : null,
      subtotal: amount,
      total: amount,
      created_at: now,
    });
    claim({ spaceId: space.id, date, slot: input.slot, kind: 'OFFLINE', bookingId, createdBy: actor.id, note: `Offline (${channel})` });
    const b = getBooking(bookingId);
    transition(b, 'CONFIRMED', actor, `Offline booking via ${channel.replace('_', ' ')}; inventory blocked`, { confirmed_at: now });
    return getBooking(bookingId);
  });
}

export function createBlock(business, actor, { space_id, date, slot, kind = 'BLOCK', note }) {
  const space = q.get('SELECT s.id, v.business_id FROM venue_spaces s JOIN venues v ON v.id = s.venue_id WHERE s.id = ?', space_id);
  if (!space || space.business_id !== business.id) throw notFound('Space');
  oneOf(kind, 'kind', ['BLOCK', 'MAINTENANCE']);
  oneOf(slot, 'slot', Object.keys(SLOTS));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw bad('Please choose a date');
  if (date < localToday()) throw bad('Cannot block a past date');
  return tx(() => ({ group_id: claim({ spaceId: space_id, date, slot, kind, note: note || null, createdBy: actor.id }) }));
}

export function removeBlock(business, groupId) {
  const rows = q.all(
    `SELECT h.id, h.kind, v.business_id FROM inventory_holds h JOIN venue_spaces s ON s.id = h.space_id JOIN venues v ON v.id = s.venue_id WHERE h.group_id = ?`,
    groupId,
  );
  if (!rows.length || rows[0].business_id !== business.id) throw notFound('Block');
  if (rows.some((r) => !['BLOCK', 'MAINTENANCE'].includes(r.kind))) throw forbidden('Bookings cannot be removed from the calendar — cancel the booking instead');
  q.run('DELETE FROM inventory_holds WHERE group_id = ?', groupId);
  return { removed: rows.length };
}

// ─────────────────────────────── scheduled jobs ───────────────────────────────

export function runLifecycleJobs() {
  const today = localToday();
  const released = sweepExpired();
  let upcoming = 0, completed = 0;

  for (const b of q.all("SELECT * FROM bookings WHERE status = 'CONFIRMED' AND event_date BETWEEN ? AND ?", today, addDays(today, 3))) {
    tx(() => {
      transition(b, 'UPCOMING', null, 'Event within 3 days', { reminder_sent: 1 });
      const venue = q.get('SELECT name FROM venues WHERE id = ?', b.venue_id);
      if (b.customer_id) notifyUser(b.customer_id, 'event_reminder', 'Your event is coming up', `${b.event_type} at ${venue.name} on ${b.event_date} (${SLOTS[b.slot].time}).`, { booking_id: b.id });
      notifyBusiness(b.business_id, 'upcoming_event', 'Upcoming event', `${b.code} · ${b.event_date} · ${b.guests} guests`, { booking_id: b.id });
    });
    upcoming++;
  }
  // Auto-complete the day after the event if the venue hasn't.
  for (const b of q.all("SELECT * FROM bookings WHERE status IN ('CONFIRMED','UPCOMING') AND event_date < ?", today)) {
    tx(() => completeInternal(b, null));
    completed++;
  }
  return { released, upcoming, completed };
}

// ─────────────────────────────── serialisation ───────────────────────────────

export const DISPLAY_STATUS = {
  REQUESTED: 'Awaiting venue',
  PENDING_PAYMENT: 'Payment pending',
  PAYMENT_PROCESSING: 'Payment processing',
  PAYMENT_FAILED: 'Payment failed',
  CONFIRMED: 'Confirmed',
  UPCOMING: 'Upcoming',
  COMPLETED: 'Completed',
  CANCELLATION_REQUESTED: 'Cancellation requested',
  CANCELLED: 'Cancelled',
  REFUND_PROCESSING: 'Refund processing',
  REFUNDED: 'Refunded',
  EXPIRED: 'Expired',
  REJECTED: 'Declined',
  DRAFT: 'Draft',
};

export function bookingOut(b, viewerRole, { full = false } = {}) {
  const venue = q.get('SELECT id, name, address, area_name, city, lat, lng, cover_hue FROM venues WHERE id = ?', b.venue_id);
  const space = q.get('SELECT name FROM venue_spaces WHERE id = ?', b.space_id);
  const pkg = b.package_id ? q.get('SELECT name FROM venue_packages WHERE id = ?', b.package_id) : null;
  const out = {
    id: b.id,
    code: b.code,
    status: b.status,
    status_label: DISPLAY_STATUS[b.status] || b.status,
    source: b.source,
    source_channel: b.source_channel,
    event_type: b.event_type,
    event_date: b.event_date,
    slot: b.slot,
    slot_label: SLOTS[b.slot]?.label,
    slot_time: SLOTS[b.slot]?.time,
    guests: b.guests,
    venue: venue ? { id: venue.id, name: venue.name, address: venue.address, area: venue.area_name, city: venue.city, lat: venue.lat, lng: venue.lng, cover_hue: venue.cover_hue } : null,
    space: { id: b.space_id, name: space?.name },
    package: pkg ? { id: b.package_id, name: pkg.name } : null,
    customer_name: b.customer_name,
    // Phone numbers stay behind the platform relay for online bookings.
    customer_phone: viewerRole === 'business' && b.source === 'online' ? maskPhone(b.customer_phone) : b.customer_phone,
    subtotal: b.subtotal,
    discount: b.discount,
    tax: b.tax,
    total: b.total,
    advance_amount: b.advance_amount,
    paid_amount: b.paid_amount,
    refunded_amount: b.refunded_amount,
    balance_amount: Math.max(0, b.total - b.paid_amount),
    hold_expires_at: ['REQUESTED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_FAILED'].includes(b.status) ? b.hold_expires_at : null,
    created_at: b.created_at,
    confirmed_at: b.confirmed_at,
    completed_at: b.completed_at,
    cancelled_at: b.cancelled_at,
    cancel_reason: b.cancel_reason,
  };
  if (viewerRole !== 'customer') {
    out.commission_amount = b.commission_amount;
    out.business_payable = b.business_payable;
    out.payout_status = b.payout_status;
  }
  if (full) {
    out.items = q.all('SELECT kind, ref_id, label, detail, qty, unit_price, amount FROM booking_items WHERE booking_id = ? ORDER BY rowid', b.id);
    out.history = q.all('SELECT from_status, to_status, actor_role, note, at FROM booking_status_history WHERE booking_id = ? ORDER BY at, rowid', b.id);
    out.payments = q.all('SELECT id, purpose, amount, status, gateway, gateway_order_id, gateway_payment_id, method, created_at, verified_at FROM payments WHERE booking_id = ? ORDER BY created_at', b.id);
    out.refunds = q.all('SELECT id, amount, status, policy_rule, created_at, processed_at FROM refunds WHERE booking_id = ? ORDER BY created_at', b.id);
    out.cancellation_policy = parseJson(b.cancellation_policy, []);
    out.cancellation = cancellationPreview(b);
    out.notes = b.notes;
    out.customer_email = viewerRole === 'business' && b.source === 'online' ? null : b.customer_email;
    const review = q.get('SELECT id, overall, body, created_at FROM reviews WHERE booking_id = ?', b.id);
    out.review = review || null;
    out.can_review = b.status === 'COMPLETED' && b.source === 'online' && !review;
    out.can_pay_balance = ['CONFIRMED', 'UPCOMING'].includes(b.status) && b.total > b.paid_amount && b.source === 'online';
  }
  return out;
}
