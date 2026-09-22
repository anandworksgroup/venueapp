// Availability engine.
//
// Inventory unit = (space, date, half-day). MORNING takes AM, EVENING takes PM,
// FULL_DAY takes both. Every claim on inventory — a 15-minute checkout
// reservation, a confirmed booking, an owner's offline booking, a block or a
// maintenance window — is a row in inventory_holds, and
// UNIQUE(space_id, date, unit) makes a double booking impossible at the
// database level, not just in application code.

import { q, tx, insert } from '../db/db.js';
import { config } from '../config.js';
import { SLOTS } from './catalog.js';
import { conflict, id, nowIso, localToday, addDays, bad, isDate } from '../lib/util.js';

export const MAX_ADVANCE_DAYS = 540;
const SLOT_START_HOUR = { AM: 8, PM: 17 };

export const slotUnits = (slot) => {
  const s = SLOTS[slot];
  if (!s) throw bad(`Unknown slot ${slot}`);
  return s.units;
};

/** Current IST hour, used to close slots that have already started today. */
function istHourNow() {
  const d = new Date(Date.now() + config.timezoneOffsetMinutes * 60_000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

function unitStarted(date, unit) {
  const today = localToday();
  if (date < today) return true;
  if (date > today) return false;
  return istHourNow() >= SLOT_START_HOUR[unit];
}

/** Release reservations whose checkout window lapsed (and expire their bookings). */
export function sweepExpired(filter = {}) {
  const now = nowIso();
  const where = ["kind = 'RESERVATION'", 'expires_at < ?'];
  const params = [now];
  if (filter.spaceId) { where.push('space_id = ?'); params.push(filter.spaceId); }
  if (filter.date) { where.push('date = ?'); params.push(filter.date); }
  const expired = q.all(`SELECT DISTINCT booking_id FROM inventory_holds WHERE ${where.join(' AND ')}`, ...params);
  if (!expired.length) return 0;
  tx(() => {
    q.run(`DELETE FROM inventory_holds WHERE ${where.join(' AND ')}`, ...params);
    for (const { booking_id } of expired) {
      if (!booking_id) continue;
      const b = q.get('SELECT id, status FROM bookings WHERE id = ?', booking_id);
      if (b && ['REQUESTED', 'PENDING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_PROCESSING'].includes(b.status)) {
        q.run("UPDATE bookings SET status = 'EXPIRED' WHERE id = ?", b.id);
        insert('booking_status_history', { id: id('bsh'), booking_id: b.id, from_status: b.status, to_status: 'EXPIRED', actor_role: 'system', note: 'Payment window lapsed; inventory released', at: now });
        q.run("UPDATE payments SET status = 'EXPIRED' WHERE booking_id = ? AND status IN ('CREATED','PROCESSING')", b.id);
      }
    }
  });
  return expired.length;
}

function liveHolds(spaceIds, from, to) {
  if (!spaceIds.length) return [];
  const now = nowIso();
  return q.all(
    `SELECT h.*, b.code AS booking_code, b.event_type, b.customer_name, b.status AS booking_status, b.source
       FROM inventory_holds h LEFT JOIN bookings b ON b.id = h.booking_id
      WHERE h.space_id IN (${spaceIds.map(() => '?').join(',')}) AND h.date BETWEEN ? AND ?
        AND NOT (h.kind = 'RESERVATION' AND h.expires_at < ?)`,
    ...spaceIds, from, to, now,
  );
}

export function activeSpaces(venueId) {
  return q.all('SELECT * FROM venue_spaces WHERE venue_id = ? AND active = 1 ORDER BY sort, capacity_floating', venueId);
}

const fits = (space, guests) => !guests || (space.capacity_floating >= guests && (space.min_guests || 0) <= guests);

function slotStatus(space, date, slot, unitHolds) {
  const units = SLOTS[slot].units;
  if (units.some((u) => unitStarted(date, u))) return { status: 'unavailable', reason: 'past' };
  const held = units.map((u) => unitHolds[u]).filter(Boolean);
  if (!held.length) return { status: 'available' };
  const blocked = held.some((h) => h.kind === 'BLOCK' || h.kind === 'MAINTENANCE');
  const onHold = held.every((h) => h.kind === 'RESERVATION');
  return { status: blocked ? 'unavailable' : 'booked', reason: blocked ? 'blocked' : onHold ? 'on_hold' : 'booked' };
}

/**
 * Per-day status for a venue month (the customer calendar).
 * available = some fitting space is free for the full day
 * limited   = only part-day slots (or fewer spaces) remain
 * booked    = every fitting space is taken
 * unavailable = past, blocked, beyond the booking window, or nothing fits the guest count
 */
export function venueMonth(venueId, month, guests) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month must be YYYY-MM');
  const spaces = activeSpaces(venueId);
  const fitting = spaces.filter((s) => fits(s, guests));
  const first = `${month}-01`;
  const days = [];
  const [y, mo] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lastDate = `${month}-${String(last).padStart(2, '0')}`;
  const holds = liveHolds(fitting.map((s) => s.id), first, lastDate);
  const index = new Map();
  for (const h of holds) index.set(`${h.space_id}|${h.date}|${h.unit}`, h);
  const today = localToday();
  const horizon = addDays(today, MAX_ADVANCE_DAYS);

  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (date < today || date > horizon || !fitting.length) {
      days.push({ date, status: 'unavailable', free_spaces: 0, reason: !fitting.length ? 'capacity' : date < today ? 'past' : 'beyond_window' });
      continue;
    }
    let fullDayFree = 0, anyFree = 0, blockedAll = true;
    for (const s of fitting) {
      const uh = { AM: index.get(`${s.id}|${date}|AM`), PM: index.get(`${s.id}|${date}|PM`) };
      const st = ['MORNING', 'EVENING'].map((slot) => slotStatus(s, date, slot, uh));
      const free = st.filter((x) => x.status === 'available').length;
      if (free === 2) fullDayFree++;
      if (free > 0) anyFree++;
      if (!st.every((x) => x.reason === 'blocked' || x.reason === 'past')) blockedAll = false;
    }
    let status;
    if (fullDayFree > 0 && fullDayFree === fitting.length) status = 'available';
    else if (fullDayFree > 0 || anyFree > 0) status = fullDayFree > 0 && fitting.length > 1 && fullDayFree >= Math.ceil(fitting.length / 2) ? 'available' : 'limited';
    else status = blockedAll ? 'unavailable' : 'booked';
    days.push({ date, status, free_spaces: anyFree });
  }
  return { venue_id: venueId, month, guests: guests || null, days };
}

/** Space × slot matrix for one date (the "27 September" screen). */
export function venueDate(venueId, date, guests) {
  if (!isDate(date)) throw bad('date must be YYYY-MM-DD');
  const spaces = activeSpaces(venueId);
  const holds = liveHolds(spaces.map((s) => s.id), date, date);
  const index = new Map(holds.map((h) => [`${h.space_id}|${h.unit}`, h]));
  const beyond = date > addDays(localToday(), MAX_ADVANCE_DAYS);
  return {
    venue_id: venueId,
    date,
    guests: guests || null,
    spaces: spaces.map((s) => {
      const uh = { AM: index.get(`${s.id}|AM`), PM: index.get(`${s.id}|PM`) };
      const fitsGuests = fits(s, guests);
      const slots = Object.entries(SLOTS).map(([code, meta]) => {
        let st = slotStatus(s, date, code, uh);
        if (beyond) st = { status: 'unavailable', reason: 'beyond_window' };
        else if (!fitsGuests && st.status === 'available') st = { status: 'unavailable', reason: 'capacity' };
        return { slot: code, label: meta.label, time: meta.time, ...st };
      });
      return { space_id: s.id, name: s.name, kind: s.kind, capacity_seated: s.capacity_seated, capacity_floating: s.capacity_floating, fits_guests: fitsGuests, slots };
    }),
  };
}

export function isSlotFree(spaceId, date, slot) {
  const holds = liveHolds([spaceId], date, date);
  const units = slotUnits(slot);
  return !holds.some((h) => units.includes(h.unit)) && !units.some((u) => unitStarted(date, u));
}

/**
 * Claim inventory. Must be called inside tx(). Expired reservations on the
 * same units are swept first; any remaining overlap violates the UNIQUE
 * constraint and surfaces as SLOT_UNAVAILABLE.
 */
export function claim({ spaceId, date, slot, kind, bookingId = null, expiresAt = null, note = null, createdBy = null }) {
  const units = slotUnits(slot);
  if (kind === 'RESERVATION' || kind === 'BOOKING' || kind === 'OFFLINE') {
    if (units.some((u) => unitStarted(date, u))) throw conflict('SLOT_UNAVAILABLE', 'This slot has already started or is in the past');
  }
  sweepExpired({ spaceId, date });
  const groupId = id('hg');
  const now = nowIso();
  try {
    for (const unit of units) {
      insert('inventory_holds', { id: id('hold'), space_id: spaceId, date, unit, kind, booking_id: bookingId, group_id: groupId, expires_at: expiresAt, note, created_by: createdBy, created_at: now });
    }
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      throw conflict('SLOT_UNAVAILABLE', 'Sorry — this space was just booked for that date and time. Please pick another slot.');
    }
    throw e;
  }
  return groupId;
}

/** Turn a booking's checkout reservation into a permanent booking hold. */
export function promoteToBooking(bookingId) {
  q.run("UPDATE inventory_holds SET kind = 'BOOKING', expires_at = NULL WHERE booking_id = ?", bookingId);
}

export function releaseBooking(bookingId) {
  return q.run('DELETE FROM inventory_holds WHERE booking_id = ?', bookingId).changes;
}

export function bookingHoldsAlive(bookingId) {
  const now = nowIso();
  const rows = q.all('SELECT kind, expires_at FROM inventory_holds WHERE booking_id = ?', bookingId);
  return rows.length > 0 && rows.every((h) => h.kind !== 'RESERVATION' || h.expires_at >= now);
}
