import crypto from 'node:crypto';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const bad = (message, details) => new HttpError(400, 'BAD_REQUEST', message, details);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have access to this resource') => new HttpError(403, 'FORBIDDEN', message);
export const conflict = (code, message, details) => new HttpError(409, code, message, details);

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export function id(prefix) {
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (const b of bytes) s += ALPHABET[b & 31];
  return `${prefix}_${s}`;
}

export const nowIso = () => new Date().toISOString();

/** Today's date (YYYY-MM-DD) in the platform's local timezone (IST). */
export function localToday(offsetDays = 0) {
  const ms = Date.now() + config.timezoneOffsetMinutes * 60_000 + offsetDays * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000);
}

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** 0 = Sunday … 6 = Saturday */
export const weekday = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Indian digit grouping: 325000 → "3,25,000" */
export function inr(n) {
  const neg = n < 0;
  const s = String(Math.abs(Math.round(n)));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}₹${rest ? `${rest},${last3}` : last3}`;
}

// ── tiny validation helpers ──
export function str(v, name, { min = 1, max = 500, optional = false } = {}) {
  if (v == null || v === '') {
    if (optional) return null;
    throw bad(`${name} is required`);
  }
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw bad(`${name} must be ${min}–${max} characters`);
  return t;
}

export function int(v, name, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (v == null || v === '') {
    if (optional) return null;
    throw bad(`${name} is required`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number between ${min} and ${max}`);
  return n;
}

export function oneOf(v, name, options, { optional = false } = {}) {
  if (v == null || v === '') {
    if (optional) return null;
    throw bad(`${name} is required`);
  }
  if (!options.includes(v)) throw bad(`${name} must be one of: ${options.join(', ')}`);
  return v;
}

export function arrOf(v, name, options) {
  if (v == null) return [];
  const a = Array.isArray(v) ? v : String(v).split(',').filter(Boolean);
  for (const x of a) if (options && !options.includes(x)) throw bad(`${name}: unknown value "${x}"`);
  return [...new Set(a)];
}

export const phoneRe = /^[6-9]\d{9}$/;
export function normPhone(v) {
  const digits = String(v ?? '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!phoneRe.test(digits)) throw bad('Enter a valid 10-digit Indian mobile number');
  return digits;
}

export const maskPhone = (p) => (p ? `${p.slice(0, 2)}XXXXXX${p.slice(-2)}` : null);
