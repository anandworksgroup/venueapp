# Pandal portals

One React 18 + TypeScript + Vite app with two portals:

| Path | Portal | Who |
|---|---|---|
| `/business/*` | Business portal (responsive, phone-friendly) | Venue owners and managers |
| `/admin/*` | Admin portal (desktop-first, works on tablets) | Pandal ops, finance and support |
| `/` | Landing page with links to both | |

The API contract is `../docs/API.md`. The app talks to the backend at `/api/v1`, so it never needs a hard-coded host.

## Run it (development)

```bash
# 1. backend (port 4000)
cd backend
npm install
npm run seed        # fresh demo data
npm start

# 2. portals (port 5173)
cd portals
npm install
npm run dev
```

Open http://localhost:5173/business or http://localhost:5173/admin.

The Vite dev server proxies `/api`, `/gateway` and `/media` to `http://localhost:4000`. To use a different backend, set `PANDAL_API=http://host:port` before `npm run dev`.

## Build (served by the backend)

```bash
cd portals
npm run build       # tsc -b && vite build → portals/dist
```

When `portals/dist` exists **at backend start-up**, the backend serves it at http://localhost:4000/business and http://localhost:4000/admin, and client-side routes such as `/admin/venues/ven_x` fall back to `index.html`. If the backend was already running before your first build, restart it.

## Demo logins (development seed)

| Portal | Login |
|---|---|
| Business | `owner@royalgarden.in` / `Business@123` |
| Business awaiting verification | `hello@sukhfarms.in` / `Business@123` |
| Admin (super admin) | `admin@pandal.dev` / `Admin@12345` + 2FA code from `npm run totp` in `backend/` |
| Admin (finance / ops) | `finance@pandal.dev` / `Finance@12345`, `ops@pandal.dev` / `Ops@123456` (same 2FA secret) |

Each portal keeps its own session: the tokens are stored in `localStorage` as `pandal.business.token` and `pandal.admin.token`. A 401 from the API clears that portal's token and returns you to its login page.

## Code layout

```
src/
  api.ts            typed fetch client (auth header, ApiError, 401 handling, blob download)
  types.ts          API response shapes
  styles.css        design system (CSS variables; brand teal #0F5F5C + marigold #E8900C)
  ui/               Button, Card, Pill, Stat, Modal, Drawer, ConfirmDialog, Table, Tabs, Chips,
                    Field/Input/Select/NumberInput, Money, DateText, EmptyState, Spinner,
                    ErrorState (friendly 403 panel), Toast
  shared/           MapPicker/MapView (Leaflet + OSM), StatusPill, BarChart/HBars (SVG),
                    Shell (sidebar + mobile tab bar), Brand, formatters, hooks
  business/         login/register, onboarding wizard (steps/*), verification, dashboard,
                    calendar, offline booking & block modals, bookings, venue, services,
                    finance, reviews, notifications, profile
  admin/            login (2FA), dashboard, customers, businesses, venues, bookings,
                    payments, refunds, payouts, finance & ledger, reconciliation, reviews,
                    disputes, categories, coupons, locations, settings, admins, audit logs
```

No component or chart libraries are used. The only extra runtime dependencies are `react-router-dom`, `leaflet` and `react-leaflet`. Map tiles come from OpenStreetMap, with attribution.

## Conventions

- Money is shown in Indian digit grouping (`₹3,25,000`), and dates as `27 Sep 2026` (IST).
- Every list has loading, empty and error states. Every mutating button shows a pending state and surfaces the API's `error.message`. Destructive actions go through a confirm dialog, which asks for a reason where the API requires one.
- The admin sidebar hides items the signed-in role lacks (`GET /admin/me` → `permissions`, where `*` means all). Visiting a route the role can't use shows a friendly "Your role can't access this" panel.
