import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const port = Number(process.env.PORT) || 4000;

function secret(name, devFallback) {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`${name} must be set in production`);
  return devFallback;
}

export const config = {
  env,
  isProd,
  port,
  dbPath: process.env.DB_PATH || path.join(ROOT, 'data', 'pandal.db'),
  storageDir: process.env.STORAGE_DIR || path.join(ROOT, 'storage'),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
  jwtSecret: secret('JWT_SECRET', 'dev-only-jwt-secret-do-not-use-in-prod'),
  // 32-byte key for AES-256-GCM encryption of bank details / PAN.
  dataKey: crypto.createHash('sha256').update(secret('DATA_KEY', 'dev-only-data-key')).digest(),
  // Sandbox gateway: shared secret used to sign checkout results and webhooks,
  // exactly the way Razorpay/Cashfree sign theirs.
  gatewayKeySecret: secret('GATEWAY_KEY_SECRET', 'sandbox-key-secret'),
  gatewayWebhookSecret: secret('GATEWAY_WEBHOOK_SECRET', 'sandbox-webhook-secret'),
  // 'auto' tries OpenStreetMap Nominatim and falls back to the offline gazetteer.
  geocoder: process.env.GEOCODER || 'auto',
  geocoderUserAgent: process.env.GEOCODER_UA || 'PandalDev/0.1 (local development)',
  // Development conveniences: OTP echoed back in the response.
  exposeDevOtp: !isProd,
  timezoneOffsetMinutes: 330, // IST — all event dates are Indian local dates
};
