import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { openDb } from './db/db.js';
import { authenticate } from './lib/middleware.js';
import { HttpError } from './lib/util.js';
import { publicRouter } from './routes/public.js';
import { customerRouter } from './routes/customer.js';
import { businessRouter } from './routes/business.js';
import { adminRouter } from './routes/admin.js';
import { gatewayRouter, webhookHandler } from './routes/gateway.js';

export function createApp() {
  openDb();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  // Security headers + CORS for the customer web app and portals.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const origin = req.headers.origin;
    if (origin) {
      const allowed = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
      if (!config.isProd || allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      }
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Webhooks need the raw body for signature verification.
  app.post('/api/v1/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }), webhookHandler);

  app.use(express.json({ limit: '12mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(authenticate);

  app.get('/health', (_req, res) => res.json({ ok: true, env: config.env, time: new Date().toISOString() }));
  app.use('/api/v1', publicRouter);
  app.use('/api/v1', customerRouter);
  app.use('/api/v1/business', businessRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/gateway', gatewayRouter);

  // Public media (venue photos). Business documents live in storage/private and
  // are only reachable through authenticated admin routes.
  app.use('/media', express.static(path.join(config.storageDir, 'public'), { maxAge: '7d', fallthrough: false }));

  // Built portals (npm run build in /portals) served from the same origin.
  const portalDist = path.resolve(ROOT, '..', 'portals', 'dist');
  if (fs.existsSync(portalDist)) {
    app.use(express.static(portalDist, { index: false }));
    app.get(/^\/(business|admin)(\/.*)?$/, (_req, res) => res.sendFile(path.join(portalDist, 'index.html')));
  }
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><meta charset=utf-8><title>Pandal API</title>
    <body style="font-family:system-ui;padding:40px;max-width:640px">
    <h1>Pandal core backend</h1><p>API: <code>/api/v1</code> · Health: <a href="/health">/health</a></p>
    <p>Portals: <a href="/business">/business</a> · <a href="/admin">/admin</a> (after <code>npm run build</code> in /portals, or run the Vite dev server)</p>`));

  app.use((req, _res, next) => next(new HttpError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`)));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.too.large') err = new HttpError(413, 'TOO_LARGE', 'Upload is too large');
    if (err instanceof SyntaxError && 'body' in err) err = new HttpError(400, 'BAD_JSON', 'Malformed JSON body');
    const status = err.status || 500;
    if (status >= 500) console.error(`[${req.method} ${req.path}]`, err);
    res.status(status).json({ error: { code: err.code || 'INTERNAL', message: status >= 500 && config.isProd ? 'Something went wrong' : err.message, details: err.details } });
  });
  return app;
}
