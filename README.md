# Pandal

Location-first discovery and booking for venues and events. Pandal answers one question:

> Which venues around you can host **this event**, for **this many people**, on **this date**, within **this budget**?

It follows the familiar local-discovery pattern (location on top, search, categories, cards, filters, map/list, detail pages, availability, booking, payment, reviews), with its own visual identity: marigold and deep teal.

```
                         PANDAL
             ┌──────────────┼──────────────┐
      CUSTOMER APP     BUSINESS PORTAL   ADMIN PORTAL
   Flutter (Android/     React (web,       React (web)
     iOS/Web)            responsive)
             └──────────────┼──────────────┘
                     CORE BACKEND (Node)
   Location · Search · Availability · Booking · Payments & Finance · Notifications
```

| Folder | What |
|---|---|
| `backend/` | Node 22 + Express + SQLite (`node:sqlite`). Every amount, availability check and payment verification happens here. |
| `customer_app/` | Flutter customer app (Android, iOS, Web). |
| `portals/` | React + Vite app with the business portal at `/business` and the admin portal at `/admin`. |
| `docs/` | `API.md` (full API reference). |

## Run it

```bash
cd backend
npm install
npm run seed      # fresh demo marketplace (Delhi NCR, 29 venues)
npm start         # http://localhost:4000
npm test          # end-to-end rules: pricing, double booking, payments, refunds, isolation, admin login
```

Portals (dev): `cd portals && npm install && npm run dev` opens http://localhost:5173/business and http://localhost:5173/admin.

Customer app: `cd customer_app && flutter run -d chrome` (or an Android device). The API base URL defaults to `http://localhost:4000` (`10.0.2.2` on the Android emulator). Override it with `--dart-define=API_BASE=http://<lan-ip>:4000` on a physical phone.

### Demo accounts (development seed)

| Who | Login |
|---|---|
| Customer | phone `9876543210`. In development the OTP is returned by the API and pre-filled by the app. |
| Business | `owner@royalgarden.in` / `Business@123` (Royal Garden Banquet) |
| Business awaiting verification | `hello@sukhfarms.in` / `Business@123` |
| Admin | `admin@pandal.dev` / `Admin@12345` (2FA is off; start the backend with `ADMIN_2FA=on` to require authenticator codes, secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`, `npm run totp`) |
| Finance / Ops admins | `finance@pandal.dev` / `Finance@12345`, `ops@pandal.dev` / `Ops@123456` |

## Non-negotiable rules (tested in `backend/test/e2e.test.js`)

- **Never trust GPS blindly.** The location label's precision follows the fix accuracy: precise (≤100 m), area (≤1 km), city (≤10 km), or low (ask the user).
- **Real availability.** Inventory is `(space, date, half-day)`. Every claim (checkout hold, booking, offline booking, block, maintenance) is a row under `UNIQUE(space_id, date, unit)`, so two bookings can't share inventory, even under concurrent requests.
- **Server-side money.** Venue + package + services − discount + GST = total. Clients send ids, never prices.
- **Verified payments only.** Checkout signature, a server-to-server order fetch and an amount match must all pass before a booking is CONFIRMED. Webhooks are signed, and every step is idempotent.
- **Double-entry ledger.** Every money movement is a balanced transaction (capture, refund, commission/payable recognition, payout).
- **Isolation and audit.** Business data is scoped to the signed-in business. Admin roles are permission-checked, admin TOTP 2FA can be switched on with `ADMIN_2FA=on`, and every admin/business mutation is audit-logged. Bank details and PAN are encrypted with AES-256-GCM.

## MVP customer journey

Open app → location detected ("Sector 15, Faridabad") → Wedding → 27 Sep → 500 guests → results within 10 km (list/map) → under ₹2L → Royal Garden Banquet → photos, capacity, facilities, packages → September calendar → 27 Sep available → Grand Hall, evening → Premium Wedding package + catering → summary ₹3,25,000 + GST → advance → login (OTP) → pay → server verifies → **BOOKING CONFIRMED** → invoice → My Events → (after the event) review.
