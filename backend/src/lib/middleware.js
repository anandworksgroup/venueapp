import { q, insert } from '../db/db.js';
import { verifyJwt } from './security.js';
import { HttpError, forbidden, id, nowIso } from './util.js';

/** Attach req.user if a valid bearer token is present (never rejects). */
export function authenticate(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = token && verifyJwt(token);
  if (payload) {
    const user = q.get('SELECT id, role, name, phone, email, admin_role, status FROM users WHERE id = ?', payload.sub);
    if (user && user.status === 'ACTIVE' && user.role === payload.role) req.user = user;
  }
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue'));
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/**
 * Business isolation: every business route resolves the caller's business
 * from business_users; nothing trusts a business_id from the request body.
 */
export function requireBusiness(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue'));
  if (req.user.role !== 'business') return next(forbidden());
  const link = q.get(
    `SELECT b.* FROM business_users bu JOIN businesses b ON b.id = bu.business_id WHERE bu.user_id = ? LIMIT 1`,
    req.user.id,
  );
  req.business = link || null;
  next();
}

// Admin role → permission matrix.
export const ADMIN_PERMISSIONS = {
  super_admin: ['*'],
  ops: ['dashboard', 'customers.read', 'businesses.read', 'businesses.verify', 'venues.read', 'venues.verify', 'bookings.read', 'reviews.moderate', 'disputes.manage', 'catalog.manage', 'audit.read'],
  finance: ['dashboard', 'bookings.read', 'payments.read', 'refunds.manage', 'payouts.manage', 'finance.read', 'businesses.read', 'audit.read'],
  support: ['dashboard', 'customers.read', 'businesses.read', 'venues.read', 'bookings.read', 'disputes.manage', 'reviews.moderate'],
};

export const hasPerm = (user, perm) => {
  const perms = ADMIN_PERMISSIONS[user?.admin_role] || [];
  return perms.includes('*') || perms.includes(perm);
};

export function requirePerm(perm) {
  return (req, _res, next) => {
    if (!req.user || req.user.role !== 'admin') return next(forbidden());
    if (!hasPerm(req.user, perm)) return next(forbidden(`Your admin role (${req.user.admin_role}) lacks "${perm}"`));
    next();
  };
}

// ── Rate limiting (fixed window, in-memory; swap for Redis when scaling out) ──
const buckets = new Map();
export function rateLimit({ windowMs, max, name, key: keyFn }) {
  return (req, res, next) => {
    const key = `${name}:${keyFn ? keyFn(req) : req.user?.id || req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset <= now) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    res.setHeader('RateLimit-Remaining', Math.max(0, max - b.count));
    if (b.count > max) {
      res.setHeader('Retry-After', Math.ceil((b.reset - now) / 1000));
      return next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.'));
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 60_000).unref();

// ── Audit log ──
export function audit(req, action, entityType, entityId, before, after) {
  insert('audit_logs', {
    id: id('aud'),
    actor_id: req?.user?.id ?? null,
    actor_role: req?.user ? (req.user.role === 'admin' ? `admin:${req.user.admin_role}` : req.user.role) : 'system',
    action,
    entity_type: entityType,
    entity_id: entityId,
    before: before ?? null,
    after: after ?? null,
    ip: req?.ip ?? null,
    at: nowIso(),
  });
}
