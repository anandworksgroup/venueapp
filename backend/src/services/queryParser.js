// Query understanding: free text → structured search intent.
// "Wedding hall near Faridabad for 500 people on 27 September under 2 lakh"
//   → { event: wedding, place: Faridabad, guests: 500, date: 2026-09-27, budget_max: 200000 }
// Extraction order matters: money and dates are removed before guest counts
// so "27 September" or "2 lakh" never become a guest number, and place names
// are removed so "Sector 21" never does either.

import { matchPlaces } from './location.js';
import { addDays, localToday, weekday, inr } from '../lib/util.js';

const EVENT_SYNONYMS = [
  ['wedding', /\b(wedding|marriage|shaadi|shadi|vivah|nikah|pheras?)\b/],
  ['reception', /\breception\b/],
  ['engagement', /\b(engagement|sagai|roka|ring ceremony)\b/],
  ['birthday', /\b(birthday|b'?day|bday)\b/],
  ['anniversary', /\banniversary\b/],
  ['corporate', /\b(corporate|office|offsite|team outing|company)\b/],
  ['conference', /\b(conference|summit)\b/],
  ['seminar', /\b(seminar|workshop|training)\b/],
  ['baby_shower', /\b(baby shower|godh bharai)\b/],
  ['kitty_party', /\bkitty\b/],
  ['farewell', /\bfarewell\b/],
  ['exhibition', /\b(exhibition|expo|trade show)\b/],
  ['religious', /\b(religious|puja|pooja|jagran|kirtan|satsang|path)\b/],
  ['party', /\b(party|get together|get-together|celebration|bash)\b/],
];

const VENUE_TYPE_SYNONYMS = [
  ['conference_hall', /\bconference (hall|room|centre|center)\b/],
  ['party_hall', /\bparty (hall|place)\b/],
  ['banquet', /\b(banquet|banquets|banquet hall|marriage hall|wedding hall)\b/],
  ['lawn', /\b(lawn|lawns|garden|open air|outdoor)\b/],
  ['farmhouse', /\b(farm ?house|farmhouses|farm)\b/],
  ['resort', /\bresorts?\b/],
  ['hotel', /\bhotels?\b/],
];

const FACILITY_SYNONYMS = [
  ['parking', /\bparking\b/],
  ['ac', /\b(ac|a\/c|air[- ]?conditioned)\b/],
  ['rooms', /\b(rooms|stay|accommodation)\b/],
  ['catering', /\b(catering|caterer|food)\b/],
  ['decoration', /\b(decoration|decor)\b/],
  ['dj', /\b(dj|music)\b/],
  ['generator', /\b(generator|power backup)\b/],
  ['stage', /\bstage\b/],
  ['bridal_room', /\bbridal room\b/],
  ['valet', /\bvalet\b/],
  ['wifi', /\b(wi-?fi|internet)\b/],
  ['projector', /\bprojector\b/],
  ['wheelchair', /\b(wheelchair|accessible)\b/],
  ['alcohol', /\b(alcohol|bar|drinks)\b/],
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const STOPWORDS = new Set('a an the for of in at on near around me my to with and or under below within upto up venue venues place places hall halls book booking find show looking need want i we people guests pax budget rs inr lakh lakhs k date event events some good best cheap nearby near by than less'.split(' '));

function unitMultiplier(u) {
  if (!u) return 1;
  if (/^(l|lac|lacs|lakh|lakhs)$/.test(u)) return 100_000;
  if (/^(k|thousand)$/.test(u)) return 1_000;
  if (/^(cr|crore|crores)$/.test(u)) return 10_000_000;
  return 1;
}

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Pick the next occurrence of month/day on or after today when no year is given. */
function resolveDayMonth(d, m, yearStr, today) {
  const ty = Number(today.slice(0, 4));
  if (yearStr) {
    let y = Number(yearStr);
    if (y < 100) y += 2000;
    return isoDate(y, m, d);
  }
  const thisYear = isoDate(ty, m, d);
  if (thisYear && thisYear >= today) return thisYear;
  return isoDate(ty + 1, m, d);
}

export function parseQuery(input, { today = localToday() } = {}) {
  const raw = String(input ?? '').slice(0, 300);
  let t = ` ${raw.toLowerCase().replace(/₹/g, ' rs ').replace(/(\d),(?=\d)/g, '$1').replace(/\s+/g, ' ')} `;
  const out = {
    raw,
    event: null,
    venue_type: null,
    guests: null,
    budget_max: null,
    date: null,
    date_from: null,
    date_to: null,
    slot: null,
    facilities: [],
    place: null,
    near_me: false,
    radius_km: null,
    keywords: [],
    understood: [],
  };
  const cut = (m) => { t = t.replace(m, ' '); };

  // ── Radius: "within 10 km"
  let m = t.match(/\bwithin\s*(\d{1,3})\s*(?:km|kms|kilometers?)\b/);
  if (m) { out.radius_km = Number(m[1]); cut(m[0]); }
  m = t.match(/\b(\d{1,3})\s*(?:km|kms)\b/);
  if (!out.radius_km && m) { out.radius_km = Number(m[1]); cut(m[0]); }

  // ── Budget: "under 2 lakh", "below ₹50k", "budget 1.5L", "2 lakh budget"
  m = t.match(/\b(?:under|below|less than|within|upto|up to|max(?:imum)?|budget(?: of| is)?|around|about|<=?)\s*(?:rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|lac|l|k|thousand|cr|crores?)?\b/);
  if (!m) m = t.match(/\b(?:rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|lac|l|k|thousand|cr|crores?)\b(?:\s*budget)?/);
  if (!m) m = t.match(/\b(?:rs\.?|inr)\s*(\d{4,9})\b/);
  if (m) {
    const n = Number(m[1]) * unitMultiplier(m[2]);
    if (n >= 1000) { out.budget_max = Math.round(n); cut(m[0]); }
  }

  // ── Dates
  const setDate = (d, phrase) => { if (d) { out.date = d; out.date_from = d; out.date_to = d; cut(phrase); } };
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s*)?${MONTH_RE}\\.?(?:\\s*,?\\s*(\\d{4}))?\\b`));
  if (m) setDate(resolveDayMonth(Number(m[1]), MONTHS.indexOf(m[2].slice(0, 3)), m[3], today), m[0]);
  if (!out.date) {
    m = t.match(new RegExp(`\\b${MONTH_RE}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`));
    if (m) setDate(resolveDayMonth(Number(m[2]), MONTHS.indexOf(m[1].slice(0, 3)), m[3], today), m[0]);
  }
  if (!out.date) {
    m = t.match(/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) setDate(resolveDayMonth(Number(m[1]), Number(m[2]) - 1, m[3], today), m[0]);
  }
  if (!out.date) {
    if ((m = t.match(/\btoday\b/))) setDate(today, m[0]);
    else if ((m = t.match(/\b(tomorrow|tmrw)\b/))) setDate(addDays(today, 1), m[0]);
    else if ((m = t.match(/\b(this|next|coming)?\s*weekend\b/))) {
      const wd = weekday(today);
      let sat = addDays(today, (6 - wd + 7) % 7);
      if (wd === 0) sat = addDays(today, -1); // Sunday: "this weekend" is today
      if (m[1] === 'next') sat = addDays(sat, 7);
      out.date_from = sat < today ? today : sat;
      out.date_to = addDays(sat, 1);
      cut(m[0]);
    } else if ((m = t.match(new RegExp(`\\b(?:this|next|on|coming)?\\s*(${DAYS.join('|')})\\b`)))) {
      const target = DAYS.indexOf(m[1]);
      let delta = (target - weekday(today) + 7) % 7;
      if (/next/.test(m[0]) && delta < 7) delta += delta === 0 ? 7 : 0;
      setDate(addDays(today, delta), m[0]);
    }
  }

  // ── Slot
  if ((m = t.match(/\b(full day|whole day|all day)\b/))) { out.slot = 'FULL_DAY'; cut(m[0]); }
  else if ((m = t.match(/\b(morning|day ?time|lunch|brunch|afternoon)\b/))) { out.slot = 'MORNING'; cut(m[0]); }
  else if ((m = t.match(/\b(evening|night|dinner)\b/))) { out.slot = 'EVENING'; cut(m[0]); }

  // ── Near me
  if ((m = t.match(/\b(near ?me|nearby|close to me|around me)\b/))) { out.near_me = true; cut(m[0]); }

  // ── Place: explicit "near/in/at X" phrase first, then any place mention.
  const placePhrase = t.match(/\b(?:near|in|at|around|close to)\s+([a-z0-9 ]+?)(?=\s+(?:for|under|below|on|with|within|budget|having|that|which)\b|\s*$)/);
  const candidates = [];
  if (placePhrase) candidates.push(placePhrase[1]);
  const sector = t.match(/\b(?:sector|sec)[\s-]*(\d{1,3}[a-d]?)\b(?:\s+(faridabad|noida|gurugram|gurgaon))?/);
  if (sector) candidates.push(sector[0]);
  const pin = t.match(/\b(1[12]\d{4}|20\d{4})\b/);
  if (pin) candidates.push(pin[1]);
  candidates.push(t);
  for (const c of candidates) {
    const hit = matchPlaces(c, { limit: 1 })[0];
    if (hit && hit.score >= 70) {
      out.place = hit;
      // Remove the place words so their numbers don't leak into guests.
      for (const w of [placePhrase?.[0], sector?.[0], pin?.[0]]) if (w && matchPlaces(w, { limit: 1 })[0]?.id === hit.id) cut(w);
      for (const w of [hit.area, hit.city]) if (w) cut(new RegExp(`\\b${w.toLowerCase().replace(/[^a-z0-9 ]/g, '.')}\\b`));
      if (/gurgaon/.test(t) && hit.city === 'Gurugram') cut(/\bgurgaon\b/);
      if (/\bdelhi\b/.test(t) && hit.city === 'New Delhi') cut(/\bdelhi\b/);
      break;
    }
  }

  // ── Guests: "500 people", "for 500", "500 pax", "500+"
  m = t.match(/\b(\d{2,5})\s*\+?\s*(?:people|persons?|guests?|pax|ppl|heads?|members|attendees|log|jan)\b/);
  if (!m) m = t.match(/\b(?:for|capacity(?: of)?|upto|up to|around)\s*(\d{2,5})\b/);
  if (!m) m = t.match(/\b(\d{2,5})\s*\+/);
  if (m) {
    const g = Number(m[1]);
    if (g >= 10 && g <= 20000) { out.guests = g; cut(m[0]); }
  }

  // ── Event, venue type, facilities
  // Event is detected before venue type but removed after, so "wedding hall"
  // yields both event=wedding and venue_type=banquet.
  let eventMatch = null;
  for (const [code, re] of EVENT_SYNONYMS) {
    if ((m = t.match(re))) { out.event = code; eventMatch = re; break; }
  }
  for (const [code, re] of VENUE_TYPE_SYNONYMS) {
    if ((m = t.match(re))) { out.venue_type = code; cut(m[0]); break; }
  }
  if (eventMatch) t = t.replace(eventMatch, ' ');
  for (const [code, re] of FACILITY_SYNONYMS) {
    if ((m = t.match(re))) { out.facilities.push(code); cut(m[0]); }
  }

  out.keywords = t.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  // Human-readable chips so the UI can show "We understood: …"
  const u = out.understood;
  if (out.event) u.push({ field: 'event', value: out.event });
  if (out.venue_type) u.push({ field: 'venue_type', value: out.venue_type });
  if (out.place) u.push({ field: 'place', value: out.place.label });
  if (out.near_me) u.push({ field: 'near_me', value: 'Near you' });
  if (out.radius_km) u.push({ field: 'radius_km', value: `Within ${out.radius_km} km` });
  if (out.guests) u.push({ field: 'guests', value: `${out.guests} guests` });
  if (out.budget_max) u.push({ field: 'budget_max', value: `Under ${inr(out.budget_max)}` });
  if (out.date) u.push({ field: 'date', value: out.date });
  else if (out.date_from) u.push({ field: 'date', value: `${out.date_from} – ${out.date_to}` });
  if (out.slot) u.push({ field: 'slot', value: out.slot });
  for (const f of out.facilities) u.push({ field: 'facility', value: f });
  if (out.keywords.length) u.push({ field: 'keywords', value: out.keywords.join(' ') });
  return out;
}
