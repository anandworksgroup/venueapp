// Location engine. Principle: never claim more precision than the fix has.
//
//   GPS fix (lat, lng, accuracy, timestamp, provider)
//     → confidence tier from accuracy
//     → reverse geocode (Nominatim when reachable, offline gazetteer always)
//     → label at the precision the tier allows
//     → suggested search radius

import { config } from '../config.js';
import { q, parseJson } from '../db/db.js';
import { haversineKm } from '../lib/util.js';

export const CONFIDENCE = {
  precise: { maxAccuracyM: 100, radiusKm: 10, label: 'Precise' },
  area: { maxAccuracyM: 1000, radiusKm: 10, label: 'Approximate (area)' },
  city: { maxAccuracyM: 10000, radiusKm: 25, label: 'Approximate (city)' },
  low: { maxAccuracyM: Infinity, radiusKm: 25, label: 'Low accuracy' },
};

export function confidenceFor(accuracyM) {
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= 0) return 'low';
  if (accuracyM <= CONFIDENCE.precise.maxAccuracyM) return 'precise';
  if (accuracyM <= CONFIDENCE.area.maxAccuracyM) return 'area';
  if (accuracyM <= CONFIDENCE.city.maxAccuracyM) return 'city';
  return 'low';
}

let areaCache;
function allAreas() {
  if (!areaCache) {
    areaCache = q.all(
      `SELECT a.*, c.name AS city_name, c.state FROM areas a JOIN cities c ON c.id = a.city_id`,
    ).map((a) => ({ ...a, aliases: parseJson(a.aliases, []) }));
  }
  return areaCache;
}
export const invalidateAreaCache = () => { areaCache = undefined; };

export function nearestArea(lat, lng) {
  let best = null;
  for (const a of allAreas()) {
    const d = haversineKm(lat, lng, a.lat, a.lng);
    if (!best || d < best.distanceKm) best = { area: a, distanceKm: d };
  }
  return best;
}

export function nearestCity(lat, lng) {
  let best = null;
  for (const c of q.all('SELECT * FROM cities')) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (!best || d < best.distanceKm) best = { city: c, distanceKm: d };
  }
  return best;
}

function offlineReverse(lat, lng) {
  const na = nearestArea(lat, lng);
  const nc = nearestCity(lat, lng);
  const inArea = na && na.distanceKm <= na.area.radius_km * 1.6;
  const inCity = nc && nc.distanceKm <= 35;
  return {
    source: 'gazetteer',
    road: null,
    area: inArea ? na.area.name : null,
    area_id: inArea ? na.area.id : null,
    city: inArea ? na.area.city_name : inCity ? nc.city.name : null,
    state: inArea ? na.area.state : inCity ? nc.city.state : null,
    pincode: inArea ? na.area.pincode : null,
    served: Boolean(inCity || inArea),
  };
}

const geoCache = new Map();
async function nominatimReverse(lat, lng) {
  if (config.geocoder === 'offline') return null;
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': config.geocoderUserAgent, 'Accept-Language': 'en-IN' },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const a = j.address || {};
    const out = {
      source: 'nominatim',
      road: a.road || a.pedestrian || null,
      area: a.suburb || a.neighbourhood || a.quarter || a.residential || a.city_district || null,
      city: a.city || a.town || a.village || a.state_district || null,
      state: a.state || null,
      pincode: a.postcode || null,
    };
    if (geoCache.size > 5000) geoCache.clear();
    geoCache.set(key, out);
    return out;
  } catch {
    return null;
  }
}

/**
 * Reverse-geocode a device fix and return a label whose precision matches
 * the fix's accuracy.
 */
export async function reverseGeocode({ lat, lng, accuracyM, provider, timestamp }) {
  const confidence = confidenceFor(accuracyM);
  const ageSec = timestamp ? Math.max(0, (Date.now() - Number(timestamp)) / 1000) : null;
  const stale = ageSec != null && ageSec > 10 * 60;

  const offline = offlineReverse(lat, lng);
  const online = confidence === 'low' ? null : await nominatimReverse(lat, lng);

  // Gazetteer area ids are what search keys on; prefer them for area/city,
  // but take the road name and pincode from the richer online result.
  const area = offline.area || online?.area || null;
  const city = offline.city || online?.city || null;
  const state = offline.state || online?.state || null;
  const pincode = online?.pincode || offline.pincode || null;

  let label;
  let canClaimAddress = false;
  if (confidence === 'precise' && online?.road) {
    label = [online.road, area, city].filter(Boolean).join(', ');
    canClaimAddress = true;
  } else if ((confidence === 'precise' || confidence === 'area') && area) {
    label = [area, city].filter(Boolean).join(', ');
  } else {
    label = city || 'Unknown location';
  }

  const warnings = [];
  if (confidence === 'low') warnings.push('Location accuracy is low. Improve location or select it manually.');
  if (confidence === 'city') warnings.push('We could only place you at city level.');
  if (stale) warnings.push('This location fix is more than 10 minutes old.');
  if (!offline.served) warnings.push('Pandal is not live in this region yet — showing the nearest venues we have.');

  return {
    lat,
    lng,
    accuracy_m: accuracyM ?? null,
    provider: provider ?? null,
    confidence,
    confidence_label: CONFIDENCE[confidence].label,
    can_claim_address: canClaimAddress,
    needs_confirmation: confidence === 'low' || confidence === 'city' || stale,
    label,
    road: canClaimAddress ? online.road : null,
    area: confidence === 'precise' || confidence === 'area' ? area : null,
    area_id: confidence === 'precise' || confidence === 'area' ? offline.area_id : null,
    city,
    state,
    pincode: confidence === 'precise' || confidence === 'area' ? pincode : null,
    suggested_radius_km: CONFIDENCE[confidence].radiusKm,
    served_region: offline.served,
    sources: [offline.source, online?.source].filter(Boolean),
    warnings,
  };
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\bsec\b/g, 'sector').replace(/sector\s*(\d)/g, 'sector $1').replace(/\s+/g, ' ').trim();

/** Match free text against areas, cities and pincodes. Used by the location picker and the query parser. */
export function matchPlaces(text, { limit = 8 } = {}) {
  const t = norm(text || '');
  if (!t) return [];
  const results = [];
  const pin = t.match(/\b(1[12]\d{4}|20\d{4})\b/);
  for (const a of allAreas()) {
    const names = [a.name, ...a.aliases].map(norm);
    const full = `${norm(a.name)} ${norm(a.city_name)}`;
    let score = 0;
    if (pin && a.pincode === pin[1]) score = 90;
    for (const n of names) {
      if (t === n || t === `${n} ${norm(a.city_name)}`) score = Math.max(score, 100);
      else if (new RegExp(`\\b${n}\\b`).test(t)) score = Math.max(score, 80 + n.length / 10);
      else if (n.startsWith(t) || full.startsWith(t)) score = Math.max(score, 60);
      else if (t.length >= 3 && full.includes(t)) score = Math.max(score, 40);
    }
    // Disambiguate "Sector 18" style names by city mention.
    if (score && t.includes(norm(a.city_name))) score += 15;
    if (score) {
      results.push({
        type: 'area',
        id: a.id,
        label: `${a.name}, ${a.city_name}`,
        area: a.name,
        city: a.city_name,
        state: a.state,
        pincode: a.pincode,
        lat: a.lat,
        lng: a.lng,
        score,
      });
    }
  }
  for (const c of q.all('SELECT * FROM cities')) {
    const n = norm(c.name);
    const alt = n === 'new delhi' ? ['delhi'] : n === 'gurugram' ? ['gurgaon'] : [];
    let score = 0;
    for (const x of [n, ...alt]) {
      if (t === x) score = Math.max(score, 95);
      else if (new RegExp(`\\b${x}\\b`).test(t)) score = Math.max(score, 70);
      else if (x.startsWith(t)) score = Math.max(score, 65);
    }
    if (score) results.push({ type: 'city', id: c.id, label: `${c.name}, ${c.state}`, area: null, city: c.name, state: c.state, pincode: null, lat: c.lat, lng: c.lng, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function searchPlaces(text) {
  const local = matchPlaces(text);
  if (local.length >= 3 || config.geocoder === 'offline' || (text || '').trim().length < 3) return local;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=in&limit=5&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: { 'User-Agent': config.geocoderUserAgent }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return local;
    const rows = await res.json();
    const extra = rows.map((r) => {
      const a = r.address || {};
      const area = a.suburb || a.neighbourhood || a.quarter || null;
      const city = a.city || a.town || a.village || a.state_district || null;
      return {
        type: 'place',
        id: `osm:${r.osm_type}:${r.osm_id}`,
        label: [area, city, a.state].filter(Boolean).join(', ') || r.display_name,
        area,
        city,
        state: a.state || null,
        pincode: a.postcode || null,
        lat: Number(r.lat),
        lng: Number(r.lon),
        score: 30,
      };
    });
    return [...local, ...extra].slice(0, 8);
  } catch {
    return local;
  }
}
