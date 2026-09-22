# Pandal API v1

Base URL: `http://<host>:4000/api/v1` · JSON everywhere · amounts are **whole rupees (INR)** · dates are `YYYY-MM-DD` (IST).

Errors: `{ "error": { "code": "SLOT_UNAVAILABLE", "message": "human readable", "details": … } }` with a matching HTTP status (400 validation, 401 unauthenticated, 403 forbidden, 404, 409 conflict/state, 422, 429 rate-limited).

Auth: `Authorization: Bearer <token>`. Tokens come from `/auth/otp/verify` (customers), `/auth/login` (business/admin), `/auth/register-business`.

Enumerations
- slot: `MORNING` (08:00–14:00) · `EVENING` (17:00–23:00) · `FULL_DAY`
- booking status: `DRAFT REQUESTED PENDING_PAYMENT PAYMENT_PROCESSING PAYMENT_FAILED CONFIRMED UPCOMING COMPLETED CANCELLATION_REQUESTED CANCELLED REFUND_PROCESSING REFUNDED EXPIRED REJECTED`
- venue status: `DRAFT SUBMITTED UNDER_REVIEW APPROVED PUBLISHED SUSPENDED ARCHIVED`
- business status: `DRAFT SUBMITTED UNDER_REVIEW DOCUMENTS_VERIFIED APPROVED REJECTED SUSPENDED`
- availability status: `available` (green) · `limited` (yellow) · `booked` (red) · `unavailable` (grey)

---

## Public (no login needed)

| Method | Path | Notes |
|---|---|---|
| GET | `/meta` | `event_categories[{code,name,icon}]`, `venue_types`, `facilities`, `slots`, `guest_buckets`, `budget_options`, `radius_options_km`, `sorts`, `image_categories`, `service_categories`, `document_kinds`, `today` |
| GET | `/locations/reverse?lat&lng&accuracy&provider&timestamp` | → `{confidence: precise\|area\|city\|low, label, road, area, area_id, city, state, pincode, can_claim_address, needs_confirmation, suggested_radius_km, warnings[]}`. Label precision never exceeds what `accuracy` (metres) supports. |
| GET | `/locations/search?q=` | areas / cities / pincodes → `items[{type,id,label,area,city,state,pincode,lat,lng}]` |
| GET | `/locations/popular` | areas with live venues + `cities` |
| GET | `/search/parse?q=` | query understanding → `{event, venue_type, guests, budget_max, date, date_from, date_to, slot, facilities[], place, near_me, radius_km, keywords[], understood[{field,value}]}` |
| GET | `/search/suggest?q=` | `{venues[], categories[], parsed}` for typeahead |
| GET | `/venues` | search. Query: `q` (free text, parsed), `lat,lng,location_label`, `radius_km`, `event`, `date` or `date_from,date_to`, `slot`, `guests`, `budget_max`, `venue_type` (csv), `facilities` (csv), `sort` (`distance price_asc price_desc rating reviews newest availability`), `page`, `limit`. → `{total, page, items[VenueCard + availability + match_reasons[]], sort, sort_explanation, center, applied, understood[]}` |
| GET | `/discover/rails?lat&lng&location_label` | home/explore rails: `rails[{key,title,subtitle,items[VenueCard]}]` |
| GET | `/venues/:id?lat&lng` | VenueDetail (see below) |
| GET | `/venues/:id/availability?month=YYYY-MM&guests=` | `{days[{date,status,free_spaces}]}` |
| GET | `/venues/:id/availability/:date?guests=` | `{spaces[{space_id,name,capacity_floating,fits_guests,slots[{slot,label,time,status,reason}]}]}` |
| GET | `/venues/:id/reviews?limit&offset` | `items[Review]` |
| POST | `/quote` | body `{venue_id, space_id, date, slot, guests, event_type, package_id?, service_ids?[], coupon_code?}` → `{lines[{kind,label,detail,qty,unit_price,amount}], subtotal, discount, tax, tax_rate_bps, total, advance_pct, advance_amount, balance_amount, cancellation_policy[]}`. **Server computes every amount; any price fields sent are ignored.** |

VenueCard: `{id, name, venue_type, venue_type_label, area, city, lat, lng, distance_km, rating_avg, rating_count, starting_price, capacity_min, capacity_max, cover_hue (0-359, for generated cover art), cover_image (url|null), event_types[], facilities[], location_verified, booking_mode}`

VenueDetail = VenueCard + `{description, address, business_name, saved, advance_pct, facility_labels[{code,label}], capacity{indoor,outdoor,dining,parking_cars,rooms,max_guests}, pricing{starting_price, starting_price_explained, per_plate_from, weekend_surcharge}, spaces[{id,name,kind,description,capacity_seated,capacity_floating,min_guests,facilities[],weekend_surcharge_pct,prices{MORNING,EVENING,FULL_DAY},images[]}], gallery[{id,url,category,media_type,caption,space_id}], packages[{id,name,tier,pricing_mode(included|flat|per_plate),price,min_guests,inclusions[{code,label}],description}], services[{id,category,name,description,pricing_mode(flat|per_guest),price}], policies[], cancellation_policy[{min_days,refund_pct,label}], reviews_summary{count,overall,venue,food,service,cleanliness,value,distribution}, recent_reviews[Review]}`

## Auth

| Method | Path | Body → Response |
|---|---|---|
| POST | `/auth/otp/request` | `{phone}` → `{sent, expires_in, dev_otp?}` (`dev_otp` only outside production) |
| POST | `/auth/otp/verify` | `{phone, code, name?}` → `{token, user, is_new}` (customers) |
| POST | `/auth/login` | `{email, password, totp?, portal?: 'business'\|'admin'}` → `{token, user}`. Admins must send `totp` (errors `TOTP_REQUIRED`, `TOTP_INVALID`). |
| POST | `/auth/register-business` | `{name, email, phone, password}` → `{token, user}` |
| GET/PATCH | `/me` | `{user}` / patch `{name?, email?, city?}` |

## Customer (role customer)

| Method | Path | Notes |
|---|---|---|
| POST | `/bookings` | header `Idempotency-Key` (recommended). Body = quote body + `contact{name,phone,email?}`, `notes?`. Creates booking + 15-min inventory hold → Booking(full). 409 `SLOT_UNAVAILABLE` if taken. Request-mode venues return status `REQUESTED`. |
| GET | `/bookings` | `{upcoming[Booking], past[Booking]}` |
| GET | `/bookings/:id` | Booking(full) (id or code) |
| POST | `/bookings/:id/pay` | `{purpose: 'advance'\|'balance', return_url?}` → `{payment_id, order_id, amount, checkout_url, hold_expires_at}`. Open `checkout_url` in a browser. |
| POST | `/payments/verify` | `{order_id, payment_id, signature}` (from the gateway redirect) or just `{order_id}` to poll → `{outcome: captured\|failed\|pending\|refunded, booking}`. Booking is CONFIRMED only after server-side verification. |
| POST | `/bookings/:id/cancel` | `{reason?}` → Booking(full). Refund follows the snapshotted policy. |
| GET | `/bookings/:id/invoice?token=` | printable HTML invoice |
| GET/POST | `/bookings/:id/messages` | relay chat with the venue `{body}` |
| POST | `/bookings/:id/review` | `{overall 1-5, venue?, food?, service?, cleanliness?, value?, body?}` — only COMPLETED bookings, once |
| POST | `/bookings/:id/disputes` | `{subject, body}` |
| GET | `/saved` · PUT/DELETE `/saved/:venueId` | saved venues |
| GET | `/notifications` · POST `/notifications/read {ids?}` | `{unread, items[{id,type,title,body,data,read_at,created_at}]}` |

Booking: `{id, code, status, status_label, source, event_type, event_date, slot, slot_label, slot_time, guests, venue{id,name,address,area,city,lat,lng,cover_hue}, space{id,name}, package{id,name}|null, customer_name, customer_phone, subtotal, discount, tax, total, advance_amount, paid_amount, refunded_amount, balance_amount, hold_expires_at, created_at, confirmed_at, completed_at, cancelled_at}`
Booking(full) adds `items[], history[{from_status,to_status,actor_role,note,at}], payments[], refunds[], cancellation_policy[], cancellation{cancellable, days_before, rule, refund_amount, retained_amount}, notes, review, can_review, can_pay_balance`. Business/admin views add `commission_amount, business_payable, payout_status`; business sees the customer phone masked for online bookings.

## Business portal (role business) — prefix `/business`

| Method | Path | Notes |
|---|---|---|
| GET | `/business/me` | `{business|null, venues[], documents[], checklist[{key,label,done}], user}` |
| POST | `/business` | create profile `{type:'venue', name, owner_name, phone, email}` |
| PUT | `/business/profile` | `{name, legal_name, owner_name, phone, email, gstin, pan, address, city, state, pincode, bank_holder, bank_account, bank_ifsc}` (bank/PAN encrypted at rest, returned masked) |
| POST | `/business/documents` | `{kind, file_name, mime(application/pdf\|image/jpeg\|image/png), data_base64}` ≤ 8 MB |
| POST | `/business/submit` | submit business + draft venues for verification (validates completeness) |
| GET | `/business/verification` | status + event timeline |
| GET/POST | `/business/venues` | list / create `{name, venue_type, description, address, event_types[], facilities[], parking_cars, rooms, advance_pct, booking_mode, policies[], cancellation_policy[]}` |
| GET/PUT | `/business/venues/:id` | detail (+ `all_spaces`, `all_packages`, `all_services`, `status`) / update |
| PUT | `/business/venues/:id/location` | `{lat, lng, address, pincode, area?, city?, state?}` → `{warnings[]}`. Moving the pin resets location verification. |
| POST/PUT | `/business/venues/:id/spaces[/:sid]` | `{name, kind(indoor\|outdoor\|dining\|rooftop\|poolside), capacity_seated, capacity_floating, min_guests, price_morning, price_evening, price_full_day, weekend_surcharge_pct, facilities[], description, active}` |
| POST/PUT | `/business/venues/:id/packages[/:pid]` | `{name, tier, pricing_mode, price, min_guests, inclusions[{code,label}], description, active}` |
| POST/PUT | `/business/venues/:id/services[/:sid]` | `{category, name, description, pricing_mode(flat\|per_guest), price, active}` |
| POST | `/business/venues/:id/images` | `{category, mime, data_base64, space_id?, caption?}` ≤ 6 MB · POST `/videos {url}` · DELETE `/images/:imgId` |
| GET | `/business/calendar?venue_id&month` | `{spaces[], days[{date, past, status(available\|partial\|booked), spaces[{space_id, AM:Cell\|null, PM:Cell\|null}]}]}` where Cell = `{kind(RESERVATION\|BOOKING\|OFFLINE\|BLOCK\|MAINTENANCE), group_id, booking_id, code, status, event_type, customer_name, guests, note}` |
| POST | `/business/holds` | `{space_id, date, slot, kind: BLOCK\|MAINTENANCE, note}` · DELETE `/business/holds/:groupId` |
| POST | `/business/offline-bookings` | `{space_id, date, slot, customer_name, customer_phone?, source_channel(phone\|walk_in\|whatsapp\|existing_customer\|other), event_type, guests, amount, notes}` → blocks inventory instantly |
| GET | `/business/bookings?tab=new\|pending\|confirmed\|upcoming\|completed\|cancelled\|offline&q=` | `{items[Booking], counts{…}}` |
| GET | `/business/bookings/:id` | Booking(full) |
| POST | `/business/bookings/:id/accept` · `/reject {reason}` · `/complete` · `/cancel {reason}` | lifecycle actions (venue cancel = full refund) |
| GET/POST | `/business/bookings/:id/messages` | relay chat (phone numbers are stripped) |
| GET | `/business/dashboard` | `{new_bookings, upcoming, pending_requests, revenue_month, collected_month, next_events[], week[{date,bookings}], rating, unread_notifications}` |
| GET | `/business/finance` | `{summary{gross_booking_value, collected, refunds, commission, net_payable, held_until_event, pending_payout, paid_out}, payouts[], ledger[], bookings[]}` |
| GET | `/business/reviews` · POST `/business/reviews/:id/reply {reply}` | |
| GET | `/business/notifications` · POST `/business/notifications/read` | |

## Admin portal (role admin + permission) — prefix `/admin`

Roles: `super_admin` (all), `ops`, `finance`, `support`. `GET /admin/me` → `{user, permissions[]}`.

| Method | Path | Permission |
|---|---|---|
| GET | `/admin/dashboard` → `{gmv, collected, platform_revenue, commission_booked, bookings, bookings_today, customers, businesses, venues, pending_verification, pending_payout, pending_refunds{c,v}, open_disputes, by_status[], daily[{d,bookings,collected}], top_cities[]}` | dashboard |
| GET | `/admin/customers?q` · POST `/admin/customers/:id/status {status: ACTIVE\|BLOCKED}` | customers.read |
| GET | `/admin/businesses?status&q` → `{items, counts}` · GET `/admin/businesses/:id` → `{business, venues, documents, events, allowed_transitions}` | businesses.read |
| POST | `/admin/businesses/:id/transition {to, reason?}` (reason required for REJECTED/SUSPENDED) | businesses.verify |
| POST | `/admin/businesses/:id/commission {commission_bps}` | payouts.manage |
| GET | `/admin/documents/:id` (streams file) · POST `/admin/documents/:id/review {status: VERIFIED\|REJECTED, note}` | businesses.verify |
| GET | `/admin/venues?status&q` · GET `/admin/venues/:id` (VenueDetail + `status, business, events, allowed_transitions`) | venues.read |
| POST | `/admin/venues/:id/transition {to, reason?}` · POST `/admin/venues/:id/verify-location {verified?, reason?}` | venues.verify |
| GET | `/admin/bookings?status&source&q` · GET `/admin/bookings/:id` (+ `messages, disputes, ledger`) | bookings.read |
| POST | `/admin/bookings/:id/cancel {reason, refund_amount?}` | refunds.manage |
| GET | `/admin/payments?status` · GET `/admin/reconciliation` | payments.read / finance.read |
| GET | `/admin/refunds?status` · POST `/admin/refunds/:id/process` | refunds.manage |
| GET | `/admin/payouts` → `{items, eligible[]}` · POST `/admin/payouts/run {business_id?}` · POST `/admin/payouts/:id/mark-paid {reference}` | payouts.manage |
| GET | `/admin/ledger?account&business_id` → `{items, balances, unbalanced_txns}` · GET `/admin/finance/summary` | finance.read |
| GET | `/admin/reviews?status` · POST `/admin/reviews/:id/status {status, reason}` | reviews.moderate |
| GET | `/admin/disputes` · POST `/admin/disputes/:id/resolve {status, resolution}` | disputes.manage |
| GET | `/admin/categories` · PUT `/admin/categories/:code` · GET `/admin/coupons` · PUT `/admin/coupons/:code` · GET `/admin/locations` | catalog.manage |
| GET/PUT | `/admin/settings` · GET/POST `/admin/admins` | super_admin |
| GET | `/admin/audit-logs?entity_type&entity_id&action` | audit.read |

## Sandbox payment gateway (development)

`GET /gateway/checkout/:orderId` hosted checkout (UPI / card / netbanking, "simulate failure"). On completion it redirects to `return_url?order_id&payment_id&signature&status` if one was given, and POSTs a signed webhook (`X-Gateway-Signature: HMAC-SHA256(body)`) to `/api/v1/payments/webhook`. Swap `services/gateway.js` for a Razorpay/Cashfree adapter in production.
