// Printable HTML invoice / booking receipt ("Save as PDF" from the browser).
import { q } from '../db/db.js';
import { inr } from './util.js';
import { SLOTS } from '../services/catalog.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderInvoice(b) {
  const venue = q.get('SELECT * FROM venues WHERE id = ?', b.venue_id);
  const biz = q.get('SELECT name, legal_name, gstin FROM businesses WHERE id = ?', b.business_id);
  const space = q.get('SELECT name FROM venue_spaces WHERE id = ?', b.space_id);
  const items = q.all('SELECT * FROM booking_items WHERE booking_id = ? ORDER BY rowid', b.id);
  const payments = q.all("SELECT * FROM payments WHERE booking_id = ? AND status = 'CAPTURED' ORDER BY verified_at", b.id);
  const refunds = q.all("SELECT * FROM refunds WHERE booking_id = ? AND status = 'PROCESSED'", b.id);
  const rows = items.map((i) => `<tr><td>${esc(i.label)}${i.detail ? `<div class=d>${esc(i.detail)}</div>` : ''}</td><td class=r>${inr(i.amount)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${esc(b.code)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1b1f;max-width:720px;margin:24px auto;padding:0 16px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0f5f5c;padding-bottom:16px}
  .brand{font-size:26px;font-weight:800;color:#0f5f5c;letter-spacing:-.5px}.brand span{color:#e8900c}
  h2{margin:0;font-size:18px}.muted{color:#666;font-size:13px}
  table{width:100%;border-collapse:collapse;margin-top:16px}td,th{padding:10px 8px;border-bottom:1px solid #eee;text-align:left;font-size:14px}
  .r{text-align:right}.d{color:#777;font-size:12px}.tot td{font-weight:700;font-size:16px;border-top:2px solid #1b1b1f}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.box{background:#f6f5f2;border-radius:10px;padding:12px}
  .pill{display:inline-block;padding:3px 10px;border-radius:99px;background:#e3f2ef;color:#0f5f5c;font-weight:600;font-size:12px}
  @media print{.noprint{display:none}}
</style></head><body>
<div class="top"><div><div class="brand">pandal<span>.</span></div><div class="muted">Booking invoice</div></div>
<div style="text-align:right"><h2>${esc(b.code)}</h2><div class="muted">Issued ${esc((b.confirmed_at || b.created_at).slice(0, 10))}</div><span class="pill">${esc(b.status)}</span></div></div>
<div class="grid">
 <div class="box"><b>${esc(venue.name)}</b><div class="muted">${esc(venue.address || '')}</div><div class="muted">${esc(biz?.legal_name || biz?.name || '')}${biz?.gstin ? ` · GSTIN ${esc(biz.gstin)}` : ''}</div></div>
 <div class="box"><b>${esc(b.customer_name || '')}</b><div class="muted">${esc(b.event_type)} · ${esc(b.event_date)}</div><div class="muted">${esc(space?.name)} · ${esc(SLOTS[b.slot]?.label)} ${esc(SLOTS[b.slot]?.time)} · ${b.guests} guests</div></div>
</div>
<table><tr><th>Item</th><th class=r>Amount</th></tr>${rows}
<tr class=tot><td>Total</td><td class=r>${inr(b.total)}</td></tr>
${payments.map((p) => `<tr><td>Paid — ${esc(p.purpose)} (${esc(p.gateway_payment_id)}, ${esc(p.method || '')})</td><td class=r>−${inr(p.amount)}</td></tr>`).join('')}
${refunds.map((r) => `<tr><td>Refunded (${esc(r.gateway_refund_id)})</td><td class=r>+${inr(r.amount)}</td></tr>`).join('')}
<tr class=tot><td>Balance payable at venue</td><td class=r>${inr(Math.max(0, b.total - b.paid_amount))}</td></tr></table>
<p class="muted">Amounts calculated by Pandal's servers at the time of booking. Cancellation policy applies as shown in your booking.</p>
<button class="noprint" onclick="print()" style="padding:10px 18px;border-radius:8px;border:0;background:#0f5f5c;color:#fff;font-weight:600">Download / Print</button>
</body></html>`;
}
