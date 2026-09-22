// Finance: double-entry ledger, commission, payouts.
//
// Accounts
//   GATEWAY_CLEARING     money held at the payment gateway / nodal account
//   CUSTOMER_DEPOSITS    advances owed back to customers until the event happens
//   PLATFORM_COMMISSION  platform revenue
//   BUSINESS_PAYABLE     owed to a business (business_id on the row)
//   BANK_PAYOUTS         money sent to business bank accounts
//
// Lifecycle: capture → (refund) → event completed: recognise commission and
// payable → payout. Each step is one txn_id with debits == credits.

import { q, insert } from '../db/db.js';
import { id, nowIso, bad } from '../lib/util.js';

function post(txnId, entries, meta) {
  const dr = entries.reduce((a, e) => a + (e.debit || 0), 0);
  const cr = entries.reduce((a, e) => a + (e.credit || 0), 0);
  if (dr !== cr) throw new Error(`Unbalanced ledger txn ${txnId}: ${dr} != ${cr}`);
  const at = nowIso();
  for (const e of entries) {
    if (!e.debit && !e.credit) continue;
    insert('financial_ledger', {
      id: id('led'),
      txn_id: txnId,
      account: e.account,
      debit: e.debit || 0,
      credit: e.credit || 0,
      booking_id: meta.booking_id ?? null,
      business_id: e.business_id ?? meta.business_id ?? null,
      ref_type: meta.ref_type,
      ref_id: meta.ref_id,
      memo: meta.memo ?? null,
      at,
    });
  }
  return txnId;
}

export function postCapture(payment, booking) {
  return post(`txn_cap_${payment.id}`, [
    { account: 'GATEWAY_CLEARING', debit: payment.amount },
    { account: 'CUSTOMER_DEPOSITS', credit: payment.amount },
  ], { booking_id: booking.id, business_id: booking.business_id, ref_type: 'payment', ref_id: payment.id, memo: `${payment.purpose} for ${booking.code}` });
}

export function postRefund(refund, booking) {
  return post(`txn_ref_${refund.id}`, [
    { account: 'CUSTOMER_DEPOSITS', debit: refund.amount },
    { account: 'GATEWAY_CLEARING', credit: refund.amount },
  ], { booking_id: booking.id, business_id: booking.business_id, ref_type: 'refund', ref_id: refund.id, memo: `Refund for ${booking.code}` });
}

/**
 * Commission on the booking value, capped at the money the platform holds.
 * Cancelled bookings: commission applies only to the retained amount.
 */
export function computeCommission(booking) {
  const retained = booking.paid_amount - booking.refunded_amount;
  const base = ['CANCELLED', 'REFUND_PROCESSING', 'REFUNDED'].includes(booking.status) ? retained : booking.total;
  const commission = Math.min(retained, Math.round((base * booking.commission_bps) / 10_000));
  return { commission, payable: Math.max(0, retained - commission), retained };
}

/** Event done (or cancellation settled): move deposits to commission + payable. */
export function recognise(booking) {
  const { commission, payable, retained } = computeCommission(booking);
  q.run("UPDATE bookings SET commission_amount = ?, business_payable = ?, payout_status = ? WHERE id = ?",
    commission, payable, payable > 0 ? 'ELIGIBLE' : 'PAID', booking.id);
  if (retained <= 0) return null;
  return post(`txn_rec_${booking.id}`, [
    { account: 'CUSTOMER_DEPOSITS', debit: retained },
    { account: 'PLATFORM_COMMISSION', credit: commission },
    { account: 'BUSINESS_PAYABLE', credit: payable, business_id: booking.business_id },
  ], { booking_id: booking.id, business_id: booking.business_id, ref_type: 'booking', ref_id: booking.id, memo: `Settlement for ${booking.code}` });
}

/** Group all ELIGIBLE bookings of each business into a PENDING payout. */
export function createPayouts(actorId, businessId = null) {
  const rows = q.all(
    `SELECT id, business_id, business_payable FROM bookings
      WHERE payout_status = 'ELIGIBLE' AND business_payable > 0 ${businessId ? 'AND business_id = ?' : ''}
      ORDER BY business_id`,
    ...(businessId ? [businessId] : []),
  );
  const byBiz = new Map();
  for (const r of rows) {
    if (!byBiz.has(r.business_id)) byBiz.set(r.business_id, []);
    byBiz.get(r.business_id).push(r);
  }
  const created = [];
  for (const [bizId, items] of byBiz) {
    const biz = q.get('SELECT bank_account_enc, status FROM businesses WHERE id = ?', bizId);
    if (!biz?.bank_account_enc) continue; // cannot pay without bank details
    const payout = { id: id('po'), business_id: bizId, amount: items.reduce((a, i) => a + i.business_payable, 0), status: 'PENDING', created_by: actorId, created_at: nowIso() };
    insert('payouts', payout);
    for (const it of items) {
      insert('payout_items', { payout_id: payout.id, booking_id: it.id, amount: it.business_payable });
      q.run("UPDATE bookings SET payout_status = 'IN_PAYOUT' WHERE id = ?", it.id);
    }
    created.push(payout);
  }
  return created;
}

export function markPayoutPaid(payoutId, reference) {
  const p = q.get('SELECT * FROM payouts WHERE id = ?', payoutId);
  if (!p) throw bad('Payout not found');
  if (p.status === 'PAID') return p;
  if (!['PENDING', 'PROCESSING'].includes(p.status)) throw bad(`Payout is ${p.status}`);
  const now = nowIso();
  q.run("UPDATE payouts SET status = 'PAID', reference = ?, paid_at = ? WHERE id = ?", reference, now, p.id);
  q.run("UPDATE bookings SET payout_status = 'PAID' WHERE id IN (SELECT booking_id FROM payout_items WHERE payout_id = ?)", p.id);
  post(`txn_po_${p.id}`, [
    { account: 'BUSINESS_PAYABLE', debit: p.amount, business_id: p.business_id },
    { account: 'BANK_PAYOUTS', credit: p.amount },
  ], { business_id: p.business_id, ref_type: 'payout', ref_id: p.id, memo: `Payout ${reference || ''}`.trim() });
  return { ...p, status: 'PAID', reference, paid_at: now };
}

export function accountBalances(businessId = null) {
  const rows = q.all(
    `SELECT account, SUM(debit) AS debit, SUM(credit) AS credit FROM financial_ledger ${businessId ? 'WHERE business_id = ?' : ''} GROUP BY account`,
    ...(businessId ? [businessId] : []),
  );
  return Object.fromEntries(rows.map((r) => [r.account, { debit: r.debit, credit: r.credit, balance: r.credit - r.debit }]));
}

export function businessFinance(businessId) {
  const agg = q.get(
    `SELECT COALESCE(SUM(CASE WHEN status NOT IN ('EXPIRED','PAYMENT_FAILED','PENDING_PAYMENT','PAYMENT_PROCESSING','REJECTED','REQUESTED','DRAFT') THEN total END),0) AS gross_booking_value,
            COALESCE(SUM(paid_amount),0) AS collected,
            COALESCE(SUM(refunded_amount),0) AS refunds,
            COALESCE(SUM(CASE WHEN paid_amount > 0 THEN commission_amount END),0) AS commission,
            COALESCE(SUM(CASE WHEN payout_status IN ('ELIGIBLE','IN_PAYOUT') THEN business_payable END),0) AS pending_payout,
            COALESCE(SUM(CASE WHEN payout_status = 'PAID' THEN business_payable END),0) AS paid_out,
            COALESCE(SUM(CASE WHEN payout_status = 'NOT_ELIGIBLE' AND paid_amount > 0 THEN business_payable END),0) AS held_until_event
       FROM bookings WHERE business_id = ? AND source = 'online'`,
    businessId,
  );
  // Net payable = everything the platform owes this business over its lifetime:
  // collected − refunds − commission = held_until_event + pending_payout + paid_out.
  return { ...agg, net_payable: agg.collected - agg.refunds - agg.commission };
}
