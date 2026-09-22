-- Pandal core schema. Money is stored as whole rupees (INTEGER); every
-- rounding step is explicit in services/pricing.js.

-- ───────────────────────────── IDENTITY ─────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN ('customer','business','admin')),
  name          TEXT,
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT,
  admin_role    TEXT,                 -- super_admin | ops | finance | support
  totp_secret   TEXT,                 -- admins: base32, required for login
  city          TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED')),
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS otp_codes (
  phone      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);

-- ───────────────────────────── LOCATION ─────────────────────────────
CREATE TABLE IF NOT EXISTS cities (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  state TEXT NOT NULL,
  lat   REAL NOT NULL,
  lng   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS areas (
  id        TEXT PRIMARY KEY,
  city_id   TEXT NOT NULL REFERENCES cities(id),
  name      TEXT NOT NULL,
  aliases   TEXT NOT NULL DEFAULT '[]',
  pincode   TEXT,
  lat       REAL NOT NULL,
  lng       REAL NOT NULL,
  radius_km REAL NOT NULL DEFAULT 1.5
);
CREATE INDEX IF NOT EXISTS idx_areas_city ON areas(city_id);

-- ───────────────────────────── BUSINESS ─────────────────────────────
CREATE TABLE IF NOT EXISTS businesses (
  id               TEXT PRIMARY KEY,
  owner_user_id    TEXT NOT NULL REFERENCES users(id),
  type             TEXT NOT NULL CHECK (type IN ('venue','catering','decoration','photography','other')),
  name             TEXT NOT NULL,
  legal_name       TEXT,
  owner_name       TEXT,
  phone            TEXT,
  email            TEXT,
  gstin            TEXT,
  pan_enc          TEXT,
  bank_holder      TEXT,
  bank_account_enc TEXT,
  bank_account_last4 TEXT,
  bank_ifsc        TEXT,
  address          TEXT,
  city             TEXT,
  state            TEXT,
  pincode          TEXT,
  status           TEXT NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','DOCUMENTS_VERIFIED','APPROVED','REJECTED','SUSPENDED')),
  rejection_reason TEXT,
  commission_bps   INTEGER NOT NULL DEFAULT 1000,
  created_at       TEXT NOT NULL,
  submitted_at     TEXT,
  approved_at      TEXT
);

CREATE TABLE IF NOT EXISTS business_users (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL DEFAULT 'owner',
  PRIMARY KEY (business_id, user_id)
);

CREATE TABLE IF NOT EXISTS business_documents (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  kind        TEXT NOT NULL,          -- gst_certificate | pan | trade_license | fire_noc | property_proof | cancelled_cheque | other
  file_name   TEXT NOT NULL,
  mime        TEXT NOT NULL,
  storage_key TEXT NOT NULL,          -- private storage, never served statically
  status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
  note        TEXT,
  uploaded_at TEXT NOT NULL
);

-- Verification trail for businesses and venues.
CREATE TABLE IF NOT EXISTS verification_events (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('business','venue')),
  entity_id   TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_id    TEXT,
  note        TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verif_entity ON verification_events(entity_type, entity_id);

-- ───────────────────────────── CATALOG ─────────────────────────────
CREATE TABLE IF NOT EXISTS event_categories (
  code   TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  icon   TEXT NOT NULL,
  sort   INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- ───────────────────────────── VENUE ─────────────────────────────
CREATE TABLE IF NOT EXISTS venues (
  id                  TEXT PRIMARY KEY,
  business_id         TEXT NOT NULL REFERENCES businesses(id),
  name                TEXT NOT NULL,
  venue_type          TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  address             TEXT,
  area_id             TEXT REFERENCES areas(id),
  area_name           TEXT,
  city                TEXT,
  state               TEXT,
  pincode             TEXT,
  lat                 REAL,
  lng                 REAL,
  location_verified   INTEGER NOT NULL DEFAULT 0,
  event_types         TEXT NOT NULL DEFAULT '[]',
  facilities          TEXT NOT NULL DEFAULT '[]',
  parking_cars        INTEGER NOT NULL DEFAULT 0,
  rooms               INTEGER NOT NULL DEFAULT 0,
  policies            TEXT NOT NULL DEFAULT '[]',
  cancellation_policy TEXT NOT NULL DEFAULT '[]',
  advance_pct         INTEGER NOT NULL DEFAULT 20 CHECK (advance_pct BETWEEN 5 AND 100),
  -- instant: pay and it's confirmed. request: owner accepts first, then customer pays.
  booking_mode        TEXT NOT NULL DEFAULT 'instant' CHECK (booking_mode IN ('instant','request')),
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','PUBLISHED','SUSPENDED','ARCHIVED')),
  rejection_reason    TEXT,
  rating_avg          REAL NOT NULL DEFAULT 0,
  rating_count        INTEGER NOT NULL DEFAULT 0,
  -- Denormalised for search; recomputed whenever spaces change.
  starting_price      INTEGER,
  capacity_min        INTEGER,
  capacity_max        INTEGER,
  cover_hue           INTEGER NOT NULL DEFAULT 30,
  booking_count       INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  published_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_venues_status ON venues(status);
CREATE INDEX IF NOT EXISTS idx_venues_geo ON venues(lat, lng);
CREATE INDEX IF NOT EXISTS idx_venues_business ON venues(business_id);

CREATE TABLE IF NOT EXISTS venue_spaces (
  id                    TEXT PRIMARY KEY,
  venue_id              TEXT NOT NULL REFERENCES venues(id),
  name                  TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('indoor','outdoor','dining','rooftop','poolside')),
  capacity_seated       INTEGER NOT NULL,
  capacity_floating     INTEGER NOT NULL,
  min_guests            INTEGER NOT NULL DEFAULT 0,
  price_morning         INTEGER NOT NULL,
  price_evening         INTEGER NOT NULL,
  price_full_day        INTEGER NOT NULL,
  weekend_surcharge_pct INTEGER NOT NULL DEFAULT 0,
  facilities            TEXT NOT NULL DEFAULT '[]',
  description           TEXT NOT NULL DEFAULT '',
  active                INTEGER NOT NULL DEFAULT 1,
  sort                  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_spaces_venue ON venue_spaces(venue_id);

CREATE TABLE IF NOT EXISTS venue_images (
  id         TEXT PRIMARY KEY,
  venue_id   TEXT NOT NULL REFERENCES venues(id),
  space_id   TEXT REFERENCES venue_spaces(id),
  category   TEXT NOT NULL,          -- exterior | main_hall | lawn | stage | dining | rooms | parking | decoration
  media_type TEXT NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo','video')),
  url        TEXT NOT NULL,
  caption    TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS venue_packages (
  id           TEXT PRIMARY KEY,
  venue_id     TEXT NOT NULL REFERENCES venues(id),
  name         TEXT NOT NULL,
  tier         TEXT NOT NULL CHECK (tier IN ('essential','premium','luxury','custom')),
  pricing_mode TEXT NOT NULL CHECK (pricing_mode IN ('included','flat','per_plate')),
  price        INTEGER NOT NULL DEFAULT 0,
  min_guests   INTEGER NOT NULL DEFAULT 0,
  inclusions   TEXT NOT NULL DEFAULT '[]',
  description  TEXT NOT NULL DEFAULT '',
  cancellation_policy TEXT,          -- optional override of the venue policy
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0
);

-- Add-on services. venue_id NULL = platform marketplace service (Phase 7).
CREATE TABLE IF NOT EXISTS services (
  id           TEXT PRIMARY KEY,
  venue_id     TEXT REFERENCES venues(id),
  category     TEXT NOT NULL,        -- catering | decoration | dj | photography | invitation | other
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  pricing_mode TEXT NOT NULL CHECK (pricing_mode IN ('flat','per_guest')),
  price        INTEGER NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0
);

-- ───────────────────────────── INVENTORY ─────────────────────────────
-- One row per (space, date, half-day unit). MORNING = AM, EVENING = PM,
-- FULL_DAY holds both. The UNIQUE constraint is the last line of defence
-- against two bookings sharing the same inventory.
CREATE TABLE IF NOT EXISTS inventory_holds (
  id         TEXT PRIMARY KEY,
  space_id   TEXT NOT NULL REFERENCES venue_spaces(id),
  date       TEXT NOT NULL,          -- YYYY-MM-DD, venue local date
  unit       TEXT NOT NULL CHECK (unit IN ('AM','PM')),
  kind       TEXT NOT NULL CHECK (kind IN ('RESERVATION','BOOKING','OFFLINE','BLOCK','MAINTENANCE')),
  booking_id TEXT REFERENCES bookings(id),
  group_id   TEXT NOT NULL,          -- ties the AM+PM rows of one full-day hold together
  expires_at TEXT,                   -- only RESERVATION holds expire
  note       TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (space_id, date, unit)
);
CREATE INDEX IF NOT EXISTS idx_holds_space_date ON inventory_holds(space_id, date);
CREATE INDEX IF NOT EXISTS idx_holds_booking ON inventory_holds(booking_id);

-- ───────────────────────────── BOOKING ─────────────────────────────
CREATE TABLE IF NOT EXISTS booking_sequences (
  day  TEXT PRIMARY KEY,
  next INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  customer_id         TEXT REFERENCES users(id),
  venue_id            TEXT NOT NULL REFERENCES venues(id),
  space_id            TEXT NOT NULL REFERENCES venue_spaces(id),
  business_id         TEXT NOT NULL REFERENCES businesses(id),
  package_id          TEXT REFERENCES venue_packages(id),
  event_type          TEXT NOT NULL,
  event_date          TEXT NOT NULL,
  slot                TEXT NOT NULL CHECK (slot IN ('MORNING','EVENING','FULL_DAY')),
  guests              INTEGER NOT NULL,
  status              TEXT NOT NULL,
  source              TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online','offline')),
  source_channel      TEXT,          -- offline: phone | walk_in | whatsapp | existing_customer
  customer_name       TEXT,
  customer_phone      TEXT,
  customer_email      TEXT,
  notes               TEXT,
  coupon_code         TEXT,
  subtotal            INTEGER NOT NULL DEFAULT 0,
  discount            INTEGER NOT NULL DEFAULT 0,
  tax                 INTEGER NOT NULL DEFAULT 0,
  total               INTEGER NOT NULL DEFAULT 0,
  advance_amount      INTEGER NOT NULL DEFAULT 0,
  paid_amount         INTEGER NOT NULL DEFAULT 0,
  refunded_amount     INTEGER NOT NULL DEFAULT 0,
  commission_bps      INTEGER NOT NULL DEFAULT 0,
  commission_amount   INTEGER NOT NULL DEFAULT 0,
  business_payable    INTEGER NOT NULL DEFAULT 0,
  cancellation_policy TEXT NOT NULL DEFAULT '[]',   -- snapshot at booking time
  payout_status       TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE'
                      CHECK (payout_status IN ('NOT_ELIGIBLE','ELIGIBLE','IN_PAYOUT','PAID')),
  idempotency_key     TEXT UNIQUE,
  hold_expires_at     TEXT,
  created_at          TEXT NOT NULL,
  confirmed_at        TEXT,
  completed_at        TEXT,
  cancelled_at        TEXT,
  cancel_reason       TEXT,
  reminder_sent       INTEGER NOT NULL DEFAULT 0,
  review_reminder_sent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_business ON bookings(business_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(event_date);

CREATE TABLE IF NOT EXISTS booking_items (
  id         TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  kind       TEXT NOT NULL CHECK (kind IN ('venue','package','service','discount','tax')),
  ref_id     TEXT,
  label      TEXT NOT NULL,
  detail     TEXT,
  qty        INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL DEFAULT 0,
  amount     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_status_history (
  id          TEXT PRIMARY KEY,
  booking_id  TEXT NOT NULL REFERENCES bookings(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_id    TEXT,
  actor_role  TEXT,
  note        TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bsh_booking ON booking_status_history(booking_id);

-- ───────────────────────────── PAYMENT ─────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                 TEXT PRIMARY KEY,
  booking_id         TEXT NOT NULL REFERENCES bookings(id),
  purpose            TEXT NOT NULL CHECK (purpose IN ('advance','balance')),
  amount             INTEGER NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'INR',
  status             TEXT NOT NULL CHECK (status IN ('CREATED','PROCESSING','CAPTURED','FAILED','EXPIRED')),
  gateway            TEXT NOT NULL,
  gateway_order_id   TEXT NOT NULL UNIQUE,
  gateway_payment_id TEXT UNIQUE,
  method             TEXT,
  failure_reason     TEXT,
  created_at         TEXT NOT NULL,
  verified_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);

-- The sandbox gateway's own records. In production this table does not
-- exist: this state lives at Razorpay/Cashfree and is fetched over their API.
CREATE TABLE IF NOT EXISTS sandbox_gateway_orders (
  order_id    TEXT PRIMARY KEY,
  amount_paise INTEGER NOT NULL,
  receipt     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('created','attempted','paid','failed')),
  payment_id  TEXT,
  method      TEXT,
  return_url  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,      -- gateway event id: processed at most once
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id                TEXT PRIMARY KEY,
  booking_id        TEXT NOT NULL REFERENCES bookings(id),
  payment_id        TEXT REFERENCES payments(id),
  amount            INTEGER NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('PENDING','PROCESSING','PROCESSED','FAILED')),
  reason            TEXT,
  policy_rule       TEXT,
  gateway_refund_id TEXT,
  created_at        TEXT NOT NULL,
  processed_at      TEXT
);

CREATE TABLE IF NOT EXISTS payouts (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  amount      INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('PENDING','PROCESSING','PAID','FAILED')),
  reference   TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  paid_at     TEXT
);

CREATE TABLE IF NOT EXISTS payout_items (
  payout_id  TEXT NOT NULL REFERENCES payouts(id),
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  amount     INTEGER NOT NULL,
  PRIMARY KEY (payout_id, booking_id)
);

-- Double-entry ledger. Every money movement is one txn_id whose debits
-- equal its credits.
CREATE TABLE IF NOT EXISTS financial_ledger (
  id          TEXT PRIMARY KEY,
  txn_id      TEXT NOT NULL,
  account     TEXT NOT NULL,
  debit       INTEGER NOT NULL DEFAULT 0,
  credit      INTEGER NOT NULL DEFAULT 0,
  booking_id  TEXT,
  business_id TEXT,
  ref_type    TEXT NOT NULL,
  ref_id      TEXT NOT NULL,
  memo        TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_txn ON financial_ledger(txn_id);
CREATE INDEX IF NOT EXISTS idx_ledger_business ON financial_ledger(business_id);

CREATE TABLE IF NOT EXISTS coupons (
  code        TEXT PRIMARY KEY,
  description TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('percent','flat')),
  value       INTEGER NOT NULL,
  max_discount INTEGER,
  min_subtotal INTEGER NOT NULL DEFAULT 0,
  valid_from  TEXT,
  valid_to    TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);

-- ───────────────────────────── REVIEWS ─────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id             TEXT PRIMARY KEY,
  booking_id     TEXT NOT NULL UNIQUE REFERENCES bookings(id),
  venue_id       TEXT NOT NULL REFERENCES venues(id),
  customer_id    TEXT NOT NULL REFERENCES users(id),
  overall        INTEGER NOT NULL CHECK (overall BETWEEN 1 AND 5),
  venue_rating   INTEGER CHECK (venue_rating BETWEEN 1 AND 5),
  food           INTEGER CHECK (food BETWEEN 1 AND 5),
  service        INTEGER CHECK (service BETWEEN 1 AND 5),
  cleanliness    INTEGER CHECK (cleanliness BETWEEN 1 AND 5),
  value          INTEGER CHECK (value BETWEEN 1 AND 5),
  body           TEXT,
  status         TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','HIDDEN')),
  business_reply TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_venue ON reviews(venue_id);

-- ───────────────────────────── COMMUNICATION ─────────────────────────────
-- Customer ↔ Platform ↔ Business relay: phone numbers are never exposed.
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  booking_id  TEXT NOT NULL REFERENCES bookings(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer','business','admin')),
  sender_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages(booking_id);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,                  -- customer / admin recipient
  business_id TEXT,                  -- business recipient
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_business ON notifications(business_id);

CREATE TABLE IF NOT EXISTS saved_venues (
  user_id  TEXT NOT NULL REFERENCES users(id),
  venue_id TEXT NOT NULL REFERENCES venues(id),
  saved_at TEXT NOT NULL,
  PRIMARY KEY (user_id, venue_id)
);

CREATE TABLE IF NOT EXISTS disputes (
  id          TEXT PRIMARY KEY,
  booking_id  TEXT NOT NULL REFERENCES bookings(id),
  raised_by   TEXT NOT NULL,
  raised_role TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','REJECTED')),
  resolution  TEXT,
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);

-- ───────────────────────────── ADMIN ─────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  before      TEXT,
  after       TEXT,
  ip          TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
