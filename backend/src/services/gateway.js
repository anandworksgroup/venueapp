// Payment gateway adapter.
//
// The interface mirrors Razorpay/Cashfree so a real adapter can replace the
// sandbox without touching the booking engine:
//   createOrder({ amount, receipt, returnUrl }) → { order_id, checkout_url }
//   fetchOrder(order_id)                      → { status, payment_id, amount, method }   (server-to-server)
//   verifyCheckoutSignature(order_id, payment_id, signature) → boolean
//   verifyWebhook(rawBody, signatureHeader)   → boolean
//   refund(payment_id, amount)                → { refund_id, status }
//
// The sandbox keeps its "remote" state in sandbox_gateway_orders and serves a
// hosted checkout page, so the full redirect → verify → webhook dance runs
// locally exactly as it would against a live gateway.

import { config } from '../config.js';
import { q, insert } from '../db/db.js';
import { hmacHex, safeEqual } from '../lib/security.js';
import { id, nowIso } from '../lib/util.js';

export const sandboxGateway = {
  name: 'sandbox',

  createOrder({ amount, receipt, returnUrl }) {
    const orderId = id('order');
    const now = nowIso();
    insert('sandbox_gateway_orders', {
      order_id: orderId,
      amount_paise: amount * 100,
      receipt,
      status: 'created',
      return_url: returnUrl ?? null,
      created_at: now,
      updated_at: now,
    });
    return { order_id: orderId, checkout_url: `${config.publicBaseUrl}/gateway/checkout/${orderId}` };
  },

  fetchOrder(orderId) {
    const o = q.get('SELECT * FROM sandbox_gateway_orders WHERE order_id = ?', orderId);
    if (!o) return null;
    return { order_id: o.order_id, status: o.status, payment_id: o.payment_id, amount: o.amount_paise / 100, method: o.method };
  },

  signCheckout(orderId, paymentId) {
    return hmacHex(config.gatewayKeySecret, `${orderId}|${paymentId}`);
  },

  verifyCheckoutSignature(orderId, paymentId, signature) {
    if (!orderId || !paymentId || !signature) return false;
    return safeEqual(this.signCheckout(orderId, paymentId), signature);
  },

  signWebhook(rawBody) {
    return hmacHex(config.gatewayWebhookSecret, rawBody);
  },

  verifyWebhook(rawBody, signature) {
    return Boolean(signature) && safeEqual(this.signWebhook(rawBody), signature);
  },

  refund(paymentId, amount) {
    return { refund_id: id('rfnd'), status: 'processed', payment_id: paymentId, amount };
  },

  /** Hosted checkout outcome (the "customer paid / failed at the gateway" moment). */
  complete(orderId, outcome, method) {
    const o = q.get('SELECT * FROM sandbox_gateway_orders WHERE order_id = ?', orderId);
    if (!o) return null;
    if (o.status === 'paid') return { ...o, signature: this.signCheckout(o.order_id, o.payment_id) };
    const paymentId = id('gpay');
    const status = outcome === 'success' ? 'paid' : 'failed';
    q.run('UPDATE sandbox_gateway_orders SET status = ?, payment_id = ?, method = ?, updated_at = ? WHERE order_id = ?', status, paymentId, method || 'upi', nowIso(), orderId);
    return { ...o, status, payment_id: paymentId, method, signature: this.signCheckout(orderId, paymentId) };
  },
};

export const gateway = sandboxGateway;
