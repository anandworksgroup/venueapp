// Sandbox payment gateway: hosted checkout page + signed webhooks.
// Stands in for Razorpay/Cashfree during development. Nothing here moves money.

import { Router } from 'express';
import { config } from '../config.js';
import { q, insert } from '../db/db.js';
import { gateway } from '../services/gateway.js';
import { verifyAndCapture } from '../services/bookings.js';
import { id, nowIso, inr } from '../lib/util.js';

export const gatewayRouter = Router();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#eef0f3;color:#15171a}
.sb{background:#fff4d6;color:#7a5200;text-align:center;font-size:12px;padding:6px;font-weight:600;letter-spacing:.3px}
.card{max-width:420px;margin:24px auto;background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.08);overflow:hidden}
.hd{background:#20243a;color:#fff;padding:20px}.hd small{opacity:.7}.amt{font-size:32px;font-weight:800;margin-top:6px}
.bd{padding:20px}label{display:flex;gap:12px;align-items:center;padding:14px;border:1.5px solid #e2e4e8;border-radius:12px;margin-bottom:10px;cursor:pointer;font-weight:600}
input[type=radio]{accent-color:#20243a;width:18px;height:18px}label:has(input:checked){border-color:#20243a;background:#f5f6fa}
button{width:100%;padding:15px;border:0;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px}
.pay{background:#1f8a4c;color:#fff}.fail{background:#fff;color:#b3261e;border:1.5px solid #f0c9c6}
.note{font-size:12px;color:#6b7078;text-align:center;margin-top:14px}.ok{font-size:54px;text-align:center}
</style></head><body><div class="sb">SANDBOX GATEWAY · test mode · no real money moves</div>${body}</body></html>`;

gatewayRouter.get('/checkout/:orderId', (req, res) => {
  const o = q.get('SELECT * FROM sandbox_gateway_orders WHERE order_id = ?', req.params.orderId);
  if (!o) return res.status(404).type('html').send(page('Not found', '<div class="card"><div class="bd">Unknown order.</div></div>'));
  if (o.status === 'paid') return res.type('html').send(page('Paid', `<div class="card"><div class="bd"><div class="ok">✓</div><p style="text-align:center">This order is already paid. You can return to the app.</p></div></div>`));
  res.type('html').send(page('Checkout', `
<div class="card"><div class="hd"><small>Paying Pandal · ${esc(o.receipt)}</small><div class="amt">${inr(o.amount_paise / 100)}</div><small>Order ${esc(o.order_id)}</small></div>
<form class="bd" method="post" action="/gateway/checkout/${esc(o.order_id)}/complete">
<label><input type="radio" name="method" value="upi" checked> UPI (any app)</label>
<label><input type="radio" name="method" value="card"> Credit / Debit card</label>
<label><input type="radio" name="method" value="netbanking"> Net banking</label>
<button class="pay" name="outcome" value="success">Pay ${inr(o.amount_paise / 100)}</button>
<button class="fail" name="outcome" value="failure">Simulate a failed payment</button>
<div class="note">The app confirms your booking only after Pandal's server verifies this payment.</div>
</form></div>`));
});

gatewayRouter.post('/checkout/:orderId/complete', async (req, res) => {
  const outcome = req.body?.outcome === 'success' ? 'success' : 'failure';
  const done = gateway.complete(req.params.orderId, outcome, req.body?.method);
  if (!done) return res.status(404).type('html').send(page('Not found', '<div class="card"><div class="bd">Unknown order.</div></div>'));

  // Fire the signed webhook the way a real gateway would (asynchronously).
  const body = JSON.stringify({
    id: id('evt'),
    type: done.status === 'paid' ? 'payment.captured' : 'payment.failed',
    created_at: nowIso(),
    data: { order_id: done.order_id, payment_id: done.payment_id, amount: done.amount_paise, method: done.method },
  });
  setTimeout(() => {
    fetch(`http://127.0.0.1:${config.port}/api/v1/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gateway-Signature': gateway.signWebhook(body) },
      body,
    }).catch((e) => console.error('[gateway] webhook delivery failed', e.message));
  }, 300);

  const params = new URLSearchParams({ order_id: done.order_id, payment_id: done.payment_id, signature: done.signature, status: done.status });
  if (done.return_url) {
    const sep = done.return_url.includes('?') ? '&' : '?';
    return res.redirect(303, `${done.return_url}${sep}${params}`);
  }
  const ok = done.status === 'paid';
  res.type('html').send(page(ok ? 'Payment successful' : 'Payment failed', `
<div class="card"><div class="bd"><div class="ok">${ok ? '✓' : '✕'}</div>
<h2 style="text-align:center;margin:4px 0">${ok ? 'Payment successful' : 'Payment failed'}</h2>
<p style="text-align:center;color:#555">${ok ? 'Return to the Pandal app — your booking is being verified.' : 'No money was taken. Return to the app to try again.'}</p>
<p class="note">Reference ${esc(done.payment_id)}</p></div></div>`));
});

/** Gateway → Pandal webhook. Signature over the raw body; each event processed once. */
export function webhookHandler(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!gateway.verifyWebhook(raw, req.get('X-Gateway-Signature'))) {
    return res.status(401).json({ error: { code: 'BAD_SIGNATURE', message: 'Invalid webhook signature' } });
  }
  let evt;
  try { evt = JSON.parse(raw); } catch { return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed' } }); }
  try {
    insert('webhook_events', { id: evt.id, type: evt.type, payload: raw, received_at: nowIso() });
  } catch {
    return res.json({ ok: true, duplicate: true });
  }
  try {
    if (evt.type === 'payment.captured' || evt.type === 'payment.failed') {
      const r = verifyAndCapture({ orderId: evt.data.order_id }, 'webhook');
      return res.json({ ok: true, outcome: r.outcome });
    }
    res.json({ ok: true, ignored: evt.type });
  } catch (e) {
    console.error('[webhook]', e.message);
    res.status(e.status || 500).json({ error: { code: e.code || 'INTERNAL', message: e.message } });
  }
}
