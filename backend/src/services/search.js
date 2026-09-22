// Search engine: query understanding → candidate retrieval → filters →
// availability → transparent sort. Every result carries the reasons it
// matched, so ranking is explainable rather than a black-box "best".

import { q } from '../db/db.js';
import { haversineKm, localToday, addDays, weekday, inr, isDate } from '../lib/util.js';
import { parseQuery } from './queryParser.js';
import { venueCard } from './venues.js';
import { venueDate } from './availability.js';
import { SORTS, SLOTS } from './catalog.js';

const SORT_EXPLANATIONS = {
  distance: 'Closest to your location first.',
  price_asc: 'Lowest starting price first (venue rental for one slot, before packages and GST).',
  price_desc: 'Highest starting price first.',
  rating: 'Highest average rating from verified bookings first; ties broken by number of reviews.',
  reviews: 'Most reviewed by verified guests first.',
  newest: 'Most recently listed on Pandal first.',
  availability: 'Venues with the most open slots on your date first, then by distance.',
};

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const list = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(',').filter(Boolean));

function dayAvailability(venueId, dates, guests, slot) {
  // Best status across the requested dates (e.g. Sat or Sun this weekend).
  let best = null;
  for (const date of dates) {
    const d = venueDate(venueId, date, guests);
    const openSlots = [];
    for (const s of d.spaces) {
      for (const sl of s.slots) {
        if (sl.status === 'available' && (!slot || sl.slot === slot)) openSlots.push({ space_id: s.space_id, space: s.name, slot: sl.slot });
      }
    }
    const fullDay = openSlots.some((o) => o.slot === 'FULL_DAY');
    const status = openSlots.length === 0 ? 'booked' : fullDay || slot ? 'available' : 'limited';
    const cand = { date, status, open_slots: openSlots.length, first_open: openSlots[0] || null };
    const rank = { available: 2, limited: 1, booked: 0 };
    if (!best || rank[cand.status] > rank[best.status] || (rank[cand.status] === rank[best.status] && cand.open_slots > best.open_slots)) best = cand;
  }
  return best;
}

export function searchVenues(params = {}) {
  const today = localToday();
  const parsed = params.q ? parseQuery(params.q, { today }) : null;

  // Explicit filters win over what we inferred from the text.
  const f = {
    event: params.event || parsed?.event || null,
    venue_types: list(params.venue_type).length ? list(params.venue_type) : parsed?.venue_type ? [parsed.venue_type] : [],
    facilities: [...new Set([...list(params.facilities), ...(parsed?.facilities || [])])],
    guests: num(params.guests) ?? parsed?.guests ?? null,
    budget_max: num(params.budget_max) ?? parsed?.budget_max ?? null,
    slot: params.slot || parsed?.slot || null,
    radius_km: num(params.radius_km) ?? parsed?.radius_km ?? null,
    keywords: parsed?.keywords || [],
    date_from: null,
    date_to: null,
  };
  if (isDate(params.date)) { f.date_from = params.date; f.date_to = params.date; }
  else if (isDate(params.date_from)) { f.date_from = params.date_from; f.date_to = isDate(params.date_to) ? params.date_to : params.date_from; }
  else if (parsed?.date_from) { f.date_from = parsed.date_from; f.date_to = parsed.date_to; }
  if (f.slot && !SLOTS[f.slot]) f.slot = null;

  // Search centre: a place named in the query beats the device location
  // ("venues in Noida" while standing in Faridabad).
  let center = null;
  if (parsed?.place && !parsed.near_me) center = { lat: parsed.place.lat, lng: parsed.place.lng, label: parsed.place.label, source: 'query' };
  else if (num(params.lat) != null && num(params.lng) != null) center = { lat: num(params.lat), lng: num(params.lng), label: params.location_label || 'your location', source: 'device' };
  if (center && f.radius_km == null && parsed?.place && !parsed.near_me) f.radius_km = parsed.place.type === 'city' ? 30 : 10;

  let rows = q.all("SELECT * FROM venues WHERE status = 'PUBLISHED'");
  const reasons = new Map();
  const why = (v, r) => { if (!reasons.has(v.id)) reasons.set(v.id, []); reasons.get(v.id).push(r); };

  if (center) {
    for (const v of rows) v._dist = haversineKm(center.lat, center.lng, v.lat, v.lng);
    if (f.radius_km) rows = rows.filter((v) => v._dist <= f.radius_km);
  }
  if (f.event) rows = rows.filter((v) => JSON.parse(v.event_types).includes(f.event));
  if (f.venue_types.length) rows = rows.filter((v) => f.venue_types.includes(v.venue_type));
  if (f.facilities.length) rows = rows.filter((v) => { const fs = JSON.parse(v.facilities); return f.facilities.every((x) => fs.includes(x)); });
  if (f.guests) rows = rows.filter((v) => v.capacity_max >= f.guests);
  if (f.budget_max) rows = rows.filter((v) => v.starting_price != null && v.starting_price <= f.budget_max);
  if (f.keywords.length) {
    rows = rows.filter((v) => {
      const hay = `${v.name} ${v.description} ${v.area_name} ${v.city} ${v.venue_type}`.toLowerCase();
      return f.keywords.every((k) => hay.includes(k));
    });
  }

  // Availability: only check what survived the cheap filters.
  let dates = [];
  if (f.date_from) {
    for (let d = f.date_from; d <= f.date_to && dates.length < 7; d = addDays(d, 1)) dates.push(d);
    for (const v of rows) v._avail = dayAvailability(v.id, dates, f.guests, f.slot);
    rows = rows.filter((v) => v._avail && v._avail.status !== 'booked');
  }

  const sort = SORTS.some(([k]) => k === params.sort) ? params.sort : center ? 'distance' : 'rating';
  const availRank = { available: 2, limited: 1, booked: 0 };
  const cmp = {
    distance: (a, b) => (a._dist ?? 1e9) - (b._dist ?? 1e9),
    price_asc: (a, b) => a.starting_price - b.starting_price,
    price_desc: (a, b) => b.starting_price - a.starting_price,
    rating: (a, b) => b.rating_avg - a.rating_avg || b.rating_count - a.rating_count,
    reviews: (a, b) => b.rating_count - a.rating_count,
    newest: (a, b) => String(b.published_at).localeCompare(String(a.published_at)),
    availability: (a, b) => (availRank[b._avail?.status] ?? -1) - (availRank[a._avail?.status] ?? -1) || (b._avail?.open_slots ?? 0) - (a._avail?.open_slots ?? 0) || (a._dist ?? 1e9) - (b._dist ?? 1e9),
  }[sort];
  rows.sort(cmp);

  const limit = Math.min(50, Math.max(1, num(params.limit) || 20));
  const page = Math.max(1, num(params.page) || 1);
  const pageRows = rows.slice((page - 1) * limit, page * limit);

  const items = pageRows.map((v) => {
    const card = venueCard(v, center || {});
    if (card.distance_km != null) why(v, `${card.distance_km} km from ${center.label}`);
    if (f.event) why(v, `Hosts ${f.event.replace('_', ' ')} events`);
    if (f.guests) why(v, `Fits ${f.guests} guests (up to ${v.capacity_max})`);
    if (f.budget_max) why(v, `Starts at ${inr(v.starting_price)}, within ${inr(f.budget_max)}`);
    if (f.facilities.length) why(v, `Has ${f.facilities.join(', ').replace(/_/g, ' ')}`);
    if (v._avail) why(v, v._avail.status === 'available' ? `Available ${v._avail.date}` : `Limited slots ${v._avail.date}`);
    return { ...card, availability: v._avail || null, match_reasons: reasons.get(v.id) || [] };
  });

  return {
    total: rows.length,
    page,
    limit,
    items,
    sort,
    sort_explanation: SORT_EXPLANATIONS[sort],
    center,
    applied: { ...f, dates },
    understood: parsed?.understood || [],
    parsed,
  };
}

export function weekendRange(today = localToday()) {
  const wd = weekday(today);
  if (wd === 6) return [today, addDays(today, 1)];
  if (wd === 0) return [today, today];
  const sat = addDays(today, 6 - wd);
  return [sat, addDays(sat, 1)];
}

/** Home / Explore rails. Each rail states why its venues are there. */
export function rails({ lat, lng, location_label } = {}) {
  const base = { lat, lng, location_label, limit: 10 };
  const [sat, sun] = weekendRange();
  const hasLoc = lat != null && lng != null;
  const out = [];
  if (hasLoc) out.push({ key: 'near_you', title: 'Near you', subtitle: 'Closest first, within 25 km', ...pick(searchVenues({ ...base, radius_km: 25, sort: 'distance' })) });
  const popular = searchVenues({ ...base, radius_km: hasLoc ? 50 : null, sort: 'reviews' });
  popular.items.sort((a, b) => b.rating_count - a.rating_count);
  out.push({ key: 'popular', title: 'Popular venues', subtitle: 'Most reviewed by verified guests', ...pick(popular) });
  out.push({ key: 'weekend', title: 'Available this weekend', subtitle: `Open slots on ${sat}${sun !== sat ? ` or ${sun}` : ''}`, ...pick(searchVenues({ ...base, radius_km: hasLoc ? 25 : null, date_from: sat, date_to: sun, sort: hasLoc ? 'distance' : 'availability' })) });
  out.push({ key: 'wedding', title: 'Wedding venues', subtitle: 'Hosts weddings, 300+ guests', ...pick(searchVenues({ ...base, radius_km: hasLoc ? 50 : null, event: 'wedding', guests: 300, sort: hasLoc ? 'distance' : 'rating' })) });
  out.push({ key: 'budget', title: 'Budget friendly', subtitle: 'Starting under ₹60,000', ...pick(searchVenues({ ...base, radius_km: hasLoc ? 50 : null, budget_max: 60000, sort: 'price_asc' })) });
  const premium = searchVenues({ ...base, radius_km: hasLoc ? 50 : null, sort: 'price_desc' });
  premium.items = premium.items.filter((v) => v.starting_price >= 150000);
  out.push({ key: 'premium', title: 'Premium venues', subtitle: 'Starting ₹1.5 lakh and above', ...pick(premium) });
  out.push({ key: 'new', title: 'New on Pandal', subtitle: 'Recently listed', ...pick(searchVenues({ ...base, radius_km: hasLoc ? 50 : null, sort: 'newest' })) });
  return out.filter((r) => r.items.length);
}

const pick = (r) => ({ items: r.items, total: r.total, sort: r.sort });
