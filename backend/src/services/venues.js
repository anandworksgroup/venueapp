import { q, parseJson } from '../db/db.js';
import { haversineKm } from '../lib/util.js';
import { DEFAULT_CANCELLATION_POLICY, FACILITIES, VENUE_TYPES, SLOTS } from './catalog.js';
import { spacePrice } from './pricing.js';

const facilityLabel = Object.fromEntries(FACILITIES);
const venueTypeLabel = Object.fromEntries(VENUE_TYPES);

/** Keep denormalised search columns in sync with the venue's spaces. */
export function recomputeVenueAggregates(venueId) {
  const agg = q.get(
    `SELECT MIN(MIN(price_morning, price_evening, price_full_day)) AS starting_price,
            MIN(CASE WHEN min_guests > 0 THEN min_guests ELSE 1 END) AS capacity_min,
            MAX(capacity_floating) AS capacity_max
       FROM venue_spaces WHERE venue_id = ? AND active = 1`,
    venueId,
  );
  q.run('UPDATE venues SET starting_price = ?, capacity_min = ?, capacity_max = ? WHERE id = ?', agg.starting_price, agg.capacity_min, agg.capacity_max, venueId);
}

export function recomputeRating(venueId) {
  const r = q.get("SELECT COUNT(*) c, AVG(overall) a FROM reviews WHERE venue_id = ? AND status = 'PUBLISHED'", venueId);
  q.run('UPDATE venues SET rating_avg = ?, rating_count = ? WHERE id = ?', r.c ? Math.round(r.a * 10) / 10 : 0, r.c, venueId);
}

export function coverImage(venueId) {
  const img = q.get("SELECT url FROM venue_images WHERE venue_id = ? AND media_type = 'photo' ORDER BY sort, created_at LIMIT 1", venueId);
  return img?.url ?? null;
}

export function venueCard(v, { lat, lng } = {}) {
  const distance = lat != null && lng != null && v.lat != null ? Math.round(haversineKm(lat, lng, v.lat, v.lng) * 10) / 10 : null;
  return {
    id: v.id,
    name: v.name,
    venue_type: v.venue_type,
    venue_type_label: venueTypeLabel[v.venue_type] || v.venue_type,
    area: v.area_name,
    city: v.city,
    lat: v.lat,
    lng: v.lng,
    distance_km: distance,
    rating_avg: v.rating_avg,
    rating_count: v.rating_count,
    starting_price: v.starting_price,
    capacity_min: v.capacity_min,
    capacity_max: v.capacity_max,
    cover_hue: v.cover_hue,
    cover_image: coverImage(v.id),
    event_types: parseJson(v.event_types, []),
    facilities: parseJson(v.facilities, []),
    location_verified: Boolean(v.location_verified),
    booking_mode: v.booking_mode,
    published_at: v.published_at,
  };
}

export function venueDetail(v, { lat, lng, userId } = {}) {
  const card = venueCard(v, { lat, lng });
  const spaces = q.all('SELECT * FROM venue_spaces WHERE venue_id = ? AND active = 1 ORDER BY sort, capacity_floating', v.id);
  const images = q.all('SELECT * FROM venue_images WHERE venue_id = ? ORDER BY sort, created_at', v.id);
  const packages = q.all('SELECT * FROM venue_packages WHERE venue_id = ? AND active = 1 ORDER BY sort, price', v.id);
  const services = q.all('SELECT * FROM services WHERE (venue_id = ? OR venue_id IS NULL) AND active = 1 ORDER BY sort, name', v.id);
  const business = q.get('SELECT name, status FROM businesses WHERE id = ?', v.business_id);
  const ratings = q.get(
    `SELECT COUNT(*) c, AVG(overall) overall, AVG(venue_rating) venue, AVG(food) food, AVG(service) service,
            AVG(cleanliness) cleanliness, AVG(value) value,
            SUM(overall = 5) s5, SUM(overall = 4) s4, SUM(overall = 3) s3, SUM(overall = 2) s2, SUM(overall = 1) s1
       FROM reviews WHERE venue_id = ? AND status = 'PUBLISHED'`,
    v.id,
  );
  const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  const recent = q.all(
    `SELECT r.*, u.name AS customer_name, b.event_type, b.event_date FROM reviews r
       JOIN users u ON u.id = r.customer_id JOIN bookings b ON b.id = r.booking_id
      WHERE r.venue_id = ? AND r.status = 'PUBLISHED' ORDER BY r.created_at DESC LIMIT 5`,
    v.id,
  );
  const saved = userId ? Boolean(q.get('SELECT 1 FROM saved_venues WHERE user_id = ? AND venue_id = ?', userId, v.id)) : false;

  const cheapest = spaces.reduce((best, s) => {
    const p = Math.min(s.price_morning, s.price_evening, s.price_full_day);
    return !best || p < best.price ? { space: s.name, price: p } : best;
  }, null);
  const perPlate = packages.filter((p) => p.pricing_mode === 'per_plate').map((p) => p.price);

  const capacity = {
    indoor: spaces.filter((s) => s.kind === 'indoor').reduce((m, s) => Math.max(m, s.capacity_floating), 0) || null,
    outdoor: spaces.filter((s) => ['outdoor', 'poolside', 'rooftop'].includes(s.kind)).reduce((m, s) => Math.max(m, s.capacity_floating), 0) || null,
    dining: spaces.filter((s) => s.kind === 'dining').reduce((m, s) => Math.max(m, s.capacity_seated), 0)
      || spaces.reduce((m, s) => Math.max(m, s.capacity_seated), 0) || null,
    parking_cars: v.parking_cars || null,
    rooms: v.rooms || null,
    max_guests: v.capacity_max,
  };

  return {
    ...card,
    description: v.description,
    address: v.address,
    state: v.state,
    pincode: v.pincode,
    business_name: business?.name ?? null,
    saved,
    advance_pct: v.advance_pct,
    facility_labels: parseJson(v.facilities, []).map((f) => ({ code: f, label: facilityLabel[f] || f })),
    capacity,
    pricing: {
      starting_price: v.starting_price,
      starting_price_explained: cheapest
        ? `Lowest venue rental: ${cheapest.space}, one slot on a weekday. Packages, add-on services and GST are extra and shown before you pay.`
        : null,
      per_plate_from: perPlate.length ? Math.min(...perPlate) : null,
      weekend_surcharge: spaces.some((s) => s.weekend_surcharge_pct > 0),
    },
    spaces: spaces.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      description: s.description,
      capacity_seated: s.capacity_seated,
      capacity_floating: s.capacity_floating,
      min_guests: s.min_guests,
      facilities: parseJson(s.facilities, []),
      weekend_surcharge_pct: s.weekend_surcharge_pct,
      prices: Object.fromEntries(Object.keys(SLOTS).map((slot) => [slot, spacePrice(s, slot, null).base])),
      images: images.filter((i) => i.space_id === s.id).map((i) => i.url),
    })),
    gallery: images.map((i) => ({ id: i.id, url: i.url, category: i.category, media_type: i.media_type, caption: i.caption, space_id: i.space_id })),
    packages: packages.map((p) => ({
      id: p.id,
      name: p.name,
      tier: p.tier,
      pricing_mode: p.pricing_mode,
      price: p.price,
      min_guests: p.min_guests,
      inclusions: parseJson(p.inclusions, []),
      description: p.description,
    })),
    services: services.map((s) => ({ id: s.id, category: s.category, name: s.name, description: s.description, pricing_mode: s.pricing_mode, price: s.price })),
    policies: parseJson(v.policies, []),
    cancellation_policy: parseJson(v.cancellation_policy, null) || DEFAULT_CANCELLATION_POLICY,
    reviews_summary: {
      count: ratings.c,
      overall: round1(ratings.overall),
      venue: round1(ratings.venue),
      food: round1(ratings.food),
      service: round1(ratings.service),
      cleanliness: round1(ratings.cleanliness),
      value: round1(ratings.value),
      distribution: { 5: ratings.s5 || 0, 4: ratings.s4 || 0, 3: ratings.s3 || 0, 2: ratings.s2 || 0, 1: ratings.s1 || 0 },
    },
    recent_reviews: recent.map(reviewOut),
  };
}

export function reviewOut(r) {
  return {
    id: r.id,
    customer_name: r.customer_name ? r.customer_name.split(' ')[0] + (r.customer_name.split(' ')[1] ? ` ${r.customer_name.split(' ')[1][0]}.` : '') : 'Guest',
    overall: r.overall,
    venue: r.venue_rating,
    food: r.food,
    service: r.service,
    cleanliness: r.cleanliness,
    value: r.value,
    body: r.body,
    business_reply: r.business_reply,
    event_type: r.event_type,
    verified_booking: true,
    created_at: r.created_at,
  };
}
