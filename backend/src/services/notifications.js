// Notification engine. In-app inbox is the source of truth; push / SMS /
// WhatsApp / email channels plug in at deliver() without changing callers.

import { insert, q } from '../db/db.js';
import { id, nowIso } from '../lib/util.js';

export const CUSTOMER_TYPES = ['booking_requested', 'booking_confirmed', 'payment_received', 'payment_failed', 'event_reminder', 'booking_cancelled', 'refund_processed', 'review_reminder', 'message', 'booking_rejected', 'booking_accepted'];
export const BUSINESS_TYPES = ['new_booking', 'new_booking_request', 'payment_received', 'cancellation', 'upcoming_event', 'customer_message', 'payout_processed', 'verification_update', 'new_review'];

const channels = [];
export const registerChannel = (fn) => channels.push(fn);

function deliver(n) {
  for (const ch of channels) {
    try { ch(n); } catch (e) { console.error('[notify] channel failed', e.message); }
  }
}

export function notifyUser(userId, type, title, body, data = {}) {
  if (!userId) return;
  const n = { id: id('ntf'), user_id: userId, business_id: null, type, title, body, data, created_at: nowIso() };
  insert('notifications', n);
  deliver(n);
}

export function notifyBusiness(businessId, type, title, body, data = {}) {
  if (!businessId) return;
  const n = { id: id('ntf'), user_id: null, business_id: businessId, type, title, body, data, created_at: nowIso() };
  insert('notifications', n);
  deliver(n);
}

export function listFor({ userId, businessId, limit = 50 }) {
  const rows = userId
    ? q.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit)
    : q.all('SELECT * FROM notifications WHERE business_id = ? ORDER BY created_at DESC LIMIT ?', businessId, limit);
  const unread = userId
    ? q.get('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL', userId).c
    : q.get('SELECT COUNT(*) c FROM notifications WHERE business_id = ? AND read_at IS NULL', businessId).c;
  return { unread, items: rows.map((r) => ({ ...r, data: JSON.parse(r.data || '{}') })) };
}

export function markRead({ userId, businessId, ids }) {
  const now = nowIso();
  const col = userId ? 'user_id' : 'business_id';
  const owner = userId || businessId;
  if (ids?.length) {
    for (const nid of ids) q.run(`UPDATE notifications SET read_at = ? WHERE id = ? AND ${col} = ? AND read_at IS NULL`, now, nid, owner);
  } else {
    q.run(`UPDATE notifications SET read_at = ? WHERE ${col} = ? AND read_at IS NULL`, now, owner);
  }
}
