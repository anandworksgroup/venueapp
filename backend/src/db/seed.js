// Development seed. Wipes the database and builds a realistic Delhi-NCR
// marketplace: ~30 venues with spaces/packages/services, a demo business
// owner, admins (2FA), customers, past bookings with reviews and ledger
// entries, future bookings for calendar variety, and one business awaiting
// verification.
//
//   npm run seed

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { openDb, closeDb, q, insert, tx, setSetting } from './db.js';
import { CITIES, AREAS } from './gazetteer.js';
import { DEFAULT_EVENT_CATEGORIES, DEFAULT_CANCELLATION_POLICY } from '../services/catalog.js';
import { hashPassword, encrypt, totpNow } from '../lib/security.js';
import { id, nowIso, localToday, addDays } from '../lib/util.js';
import { recomputeVenueAggregates, recomputeRating } from '../services/venues.js';
import { postCapture, recognise, computeCommission, createPayouts, markPayoutPaid } from '../services/finance.js';
import { invalidateAreaCache } from '../services/location.js';

export const DEV_ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

// Deterministic PRNG so every seed produces the same marketplace.
let s = 20260927;
const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const round = (n, to = 1000) => Math.round(n / to) * to;

export function seed({ dbPath = config.dbPath, quiet = false } = {}) {
  // Reset in place (drop + recreate) instead of deleting the file, so seeding
  // also works while a dev server holds the database open (Windows locks it).
  closeDb();
  const db = openDb(dbPath);
  db.exec('PRAGMA foreign_keys = OFF');
  for (const { name } of q.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) db.exec(`DROP TABLE IF EXISTS "${name}"`);
  db.exec('PRAGMA foreign_keys = ON');
  closeDb();
  openDb(dbPath);
  fs.rmSync(path.join(config.storageDir, 'private', 'biz_sukh'), { recursive: true, force: true });
  invalidateAreaCache();
  s = 20260927;
  const now = nowIso();
  const today = localToday();

  tx(() => {
    setSetting('tax_rate_bps', 1800);
    setSetting('hold_minutes', 15);
    setSetting('default_commission_bps', 1000);

    for (const c of CITIES) insert('cities', c);
    for (const [cityId, areas] of Object.entries(AREAS)) {
      for (const [aid, name, pincode, lat, lng, radius, aliases] of areas) {
        insert('areas', { id: aid, city_id: cityId, name, pincode, lat, lng, radius_km: radius, aliases: aliases || [] });
      }
    }
    DEFAULT_EVENT_CATEGORIES.forEach(([code, name, icon], i) => insert('event_categories', { code, name, icon, sort: i, active: 1 }));

    insert('coupons', { code: 'WELCOME10', description: '10% off your first booking (up to ₹10,000)', kind: 'percent', value: 10, max_discount: 10000, min_subtotal: 50000, active: 1 });
    insert('coupons', { code: 'FESTIVE5000', description: '₹5,000 off bookings above ₹1,00,000', kind: 'flat', value: 5000, min_subtotal: 100000, active: 1 });

    // ── Admins ──
    insert('users', { id: 'usr_admin', role: 'admin', name: 'Aditi (Super Admin)', email: 'admin@pandal.dev', password_hash: hashPassword('Admin@12345'), admin_role: 'super_admin', totp_secret: DEV_ADMIN_TOTP_SECRET, created_at: now });
    insert('users', { id: 'usr_fin', role: 'admin', name: 'Farhan (Finance)', email: 'finance@pandal.dev', password_hash: hashPassword('Finance@12345'), admin_role: 'finance', totp_secret: DEV_ADMIN_TOTP_SECRET, created_at: now });
    insert('users', { id: 'usr_ops', role: 'admin', name: 'Oorja (Ops)', email: 'ops@pandal.dev', password_hash: hashPassword('Ops@123456'), admin_role: 'ops', totp_secret: DEV_ADMIN_TOTP_SECRET, created_at: now });

    // ── Customers ──
    const customers = [
      ['usr_rahul', 'Rahul Sharma', '9876543210'],
      ['usr_priya', 'Priya Malhotra', '9812345670'],
      ['usr_arjun', 'Arjun Mehta', '9899001122'],
      ['usr_neha', 'Neha Gupta', '9811122233'],
      ['usr_vikram', 'Vikram Singh', '9870011223'],
      ['usr_sana', 'Sana Khan', '9958877665'],
      ['usr_karan', 'Karan Bhatia', '9711223344'],
      ['usr_meera', 'Meera Iyer', '9650011223'],
    ];
    for (const [uid, name, phone] of customers) insert('users', { id: uid, role: 'customer', name, phone, city: 'Faridabad', created_at: now });

    // ── Demo business (approved) ──
    insert('users', { id: 'usr_owner', role: 'business', name: 'Rajesh Khanna', email: 'owner@royalgarden.in', phone: '9811000111', password_hash: hashPassword('Business@123'), created_at: now });
    insert('businesses', {
      id: 'biz_royal', owner_user_id: 'usr_owner', type: 'venue', name: 'Royal Garden Hospitality', legal_name: 'Royal Garden Hospitality Pvt Ltd',
      owner_name: 'Rajesh Khanna', phone: '9811000111', email: 'owner@royalgarden.in', gstin: '06AABCR1234F1Z5', pan_enc: encrypt('AABCR1234F'),
      bank_holder: 'Royal Garden Hospitality Pvt Ltd', bank_account_enc: encrypt('50100234567890'), bank_account_last4: '7890', bank_ifsc: 'HDFC0001234',
      address: 'Plot 12, Sector 21C, Faridabad', city: 'Faridabad', state: 'Haryana', pincode: '121001',
      status: 'APPROVED', commission_bps: 1000, created_at: now, submitted_at: now, approved_at: now,
    });
    insert('business_users', { business_id: 'biz_royal', user_id: 'usr_owner', role: 'owner' });
    insert('verification_events', { id: id('ver'), entity_type: 'business', entity_id: 'biz_royal', from_status: 'DOCUMENTS_VERIFIED', to_status: 'APPROVED', actor_id: 'usr_admin', note: 'Seeded', at: now });

    const royal = {
      id: 'ven_royal', business_id: 'biz_royal', name: 'Royal Garden Banquet', venue_type: 'banquet',
      description: 'A three-space celebration venue on the Sector 21 main road: the pillar-less Grand Hall for big-fat weddings, the intimate Crystal Hall for engagements and birthdays, and a manicured 1,000-guest lawn for evening receptions under the stars. In-house vegetarian and non-vegetarian catering, a dedicated bridal suite and valet parking for 150 cars.',
      address: 'Plot 12, Sector 21C, Faridabad, Haryana 121001', area_id: 'sector-21', area_name: 'Sector 21', city: 'Faridabad', state: 'Haryana', pincode: '121001',
      lat: 28.4219, lng: 77.2998, location_verified: 1,
      event_types: ['wedding', 'reception', 'engagement', 'birthday', 'anniversary', 'corporate', 'party', 'religious'],
      facilities: ['parking', 'ac', 'rooms', 'catering', 'decoration', 'dj', 'generator', 'stage', 'bridal_room', 'valet', 'wheelchair'],
      parking_cars: 150, rooms: 8,
      policies: ['Music until 11 PM as per local regulations', 'Outside caterers not permitted', 'Firecrackers only in the designated lawn area', 'Security deposit of ₹25,000 refundable after the event'],
      cancellation_policy: DEFAULT_CANCELLATION_POLICY, advance_pct: 20, booking_mode: 'instant', status: 'PUBLISHED', cover_hue: 340,
      created_at: addDays(today, -400) + 'T00:00:00.000Z', published_at: addDays(today, -380) + 'T00:00:00.000Z',
    };
    insert('venues', royal);
    const royalSpaces = [
      { id: 'spc_grand', name: 'Grand Hall', kind: 'indoor', capacity_seated: 350, capacity_floating: 500, min_guests: 150, price_morning: 95000, price_evening: 120000, price_full_day: 180000, weekend_surcharge_pct: 0, facilities: ['ac', 'stage', 'dj'], description: 'Pillar-less 9,000 sq ft hall with a 40-ft stage and chandeliers.' },
      { id: 'spc_crystal', name: 'Crystal Hall', kind: 'indoor', capacity_seated: 180, capacity_floating: 250, min_guests: 50, price_morning: 85000, price_evening: 95000, price_full_day: 150000, weekend_surcharge_pct: 10, facilities: ['ac', 'stage'], description: 'Mirror-panelled hall for engagements, birthdays and kitty parties.' },
      { id: 'spc_lawn', name: 'Royal Lawn', kind: 'outdoor', capacity_seated: 700, capacity_floating: 1000, min_guests: 300, price_morning: 110000, price_evening: 160000, price_full_day: 240000, weekend_surcharge_pct: 15, facilities: ['stage', 'generator'], description: '45,000 sq ft lawn with a fountain, ideal for pheras and receptions.' },
    ];
    royalSpaces.forEach((sp, i) => insert('venue_spaces', { ...sp, venue_id: 'ven_royal', sort: i, active: 1 }));
    const royalPkgs = [
      { id: 'pkg_royal_ess', name: 'Essential', tier: 'essential', pricing_mode: 'included', price: 0, inclusions: [{ code: 'venue', label: 'Venue rental for your slot' }, { code: 'furniture', label: 'Standard seating & round tables' }, { code: 'parking', label: 'Parking for 150 cars' }, { code: 'lighting', label: 'House lighting' }], description: 'The space, seating and parking. Add catering and decor as you like.' },
      { id: 'pkg_royal_prem', name: 'Premium Wedding', tier: 'premium', pricing_mode: 'flat', price: 55000, inclusions: [{ code: 'venue', label: 'Venue rental for your slot' }, { code: 'decoration', label: 'Stage & entrance floral decor' }, { code: 'sound', label: 'Sound system with DJ console' }, { code: 'dj', label: 'DJ for 4 hours' }, { code: 'lighting', label: 'Uplighting & fairy lights' }, { code: 'furniture', label: 'Chiavari chairs & draped tables' }, { code: 'parking', label: 'Valet parking' }], description: 'Our most-booked wedding package: décor, DJ, lighting and premium furniture.' },
      { id: 'pkg_royal_lux', name: 'Luxury Royal', tier: 'luxury', pricing_mode: 'flat', price: 150000, inclusions: [{ code: 'venue', label: 'Venue rental for your slot' }, { code: 'decoration', label: 'Designer theme décor' }, { code: 'dj', label: 'DJ + LED dance floor' }, { code: 'sound', label: 'Line-array sound' }, { code: 'lighting', label: 'Intelligent lighting rig' }, { code: 'furniture', label: 'Luxury lounge furniture' }, { code: 'rooms', label: '4 guest rooms for the night' }, { code: 'parking', label: 'Valet parking' }], description: 'Everything, designed end-to-end by our in-house event team.' },
      { id: 'pkg_royal_plate', name: 'Veg Buffet (per plate)', tier: 'custom', pricing_mode: 'per_plate', price: 900, min_guests: 150, inclusions: [{ code: 'venue', label: 'Venue rental for your slot' }, { code: 'catering', label: '24-dish vegetarian buffet' }, { code: 'furniture', label: 'Banquet seating' }], description: '₹900 per plate with the venue included — minimum 150 plates.' },
    ];
    royalPkgs.forEach((p, i) => insert('venue_packages', { min_guests: 0, ...p, venue_id: 'ven_royal', sort: i, active: 1 }));
    const royalServices = [
      ['svc_royal_cat', 'catering', 'Catering — veg & non-veg buffet', 'per_guest', 300, 'Starters, 3 mains, live counters and desserts.'],
      ['svc_royal_dec', 'decoration', 'Decoration — floral stage & entrance', 'flat', 40000, 'Fresh-flower stage, entrance arch and table centrepieces.'],
      ['svc_royal_dj', 'dj', 'DJ & sound (5 hours)', 'flat', 15000, 'DJ, console, 4 speakers and a dance floor.'],
      ['svc_royal_photo', 'photography', 'Photography & candid video', 'flat', 45000, 'Two photographers, one videographer, edited album.'],
      ['svc_royal_inv', 'invitation', 'Invitation cards', 'per_guest', 60, 'Printed invitations with envelopes.'],
    ];
    royalServices.forEach(([sid, category, name, mode, price, desc], i) => insert('services', { id: sid, venue_id: 'ven_royal', category, name, pricing_mode: mode, price, description: desc, active: 1, sort: i }));
    recomputeVenueAggregates('ven_royal');

    // ── Generated marketplace ──
    const NAMES = {
      banquet: ['Shagun Banquets', 'Mehar Palace', 'The Grand Pavilion', 'Neelkamal Banquet', 'Swarn Mahal', 'Tulip Celebrations', 'Kesar Banquet Hall', 'Sapphire Banquets', 'Rangmahal'],
      lawn: ['Aangan Marriage Lawn', 'Green Meadows Lawn', 'Utsav Garden', 'Phoolbagh Lawns', 'Chandni Lawns'],
      farmhouse: ['Mango Orchard Farms', 'Sukoon Farmhouse', 'Banyan Tree Farm', 'The Palm Farmhouse'],
      hotel: ['Hotel Aravali Crown', 'The Mapleleaf Hotel', 'Crescent Residency'],
      resort: ['Surajkund Lakeside Resort', 'Aravalli Hills Resort'],
      party_hall: ['Confetti Party Hall', 'The Party Loft', 'Bubbles Party Hall'],
      conference_hall: ['Nexus Convention Centre', 'Summit Business Hall'],
    };
    const TYPES_EVENTS = {
      banquet: ['wedding', 'reception', 'engagement', 'birthday', 'anniversary', 'party', 'religious', 'baby_shower'],
      lawn: ['wedding', 'reception', 'engagement', 'religious', 'party'],
      farmhouse: ['wedding', 'reception', 'engagement', 'party', 'birthday', 'corporate', 'anniversary'],
      hotel: ['wedding', 'reception', 'engagement', 'corporate', 'conference', 'seminar', 'birthday', 'anniversary'],
      resort: ['wedding', 'reception', 'corporate', 'conference', 'party', 'anniversary'],
      party_hall: ['birthday', 'kitty_party', 'party', 'anniversary', 'baby_shower', 'farewell', 'engagement'],
      conference_hall: ['corporate', 'conference', 'seminar', 'exhibition', 'farewell'],
    };
    const BASE_FACILITIES = {
      banquet: ['parking', 'ac', 'catering', 'decoration', 'dj', 'generator', 'stage'],
      lawn: ['parking', 'catering', 'decoration', 'generator', 'stage'],
      farmhouse: ['parking', 'catering', 'decoration', 'dj', 'generator', 'rooms', 'alcohol'],
      hotel: ['parking', 'ac', 'rooms', 'catering', 'decoration', 'wifi', 'projector', 'valet', 'alcohol'],
      resort: ['parking', 'ac', 'rooms', 'catering', 'decoration', 'dj', 'wifi', 'alcohol'],
      party_hall: ['ac', 'catering', 'decoration', 'dj'],
      conference_hall: ['ac', 'wifi', 'projector', 'parking', 'catering', 'generator'],
    };
    const EXTRA = ['bridal_room', 'valet', 'wheelchair', 'wifi', 'stage'];
    // Where each venue type tends to cluster.
    const PLACES = ['sector-15', 'sector-16', 'sector-14', 'sector-21', 'sector-9', 'sector-28', 'sector-31', 'sector-37', 'sector-46', 'nit', 'greater-faridabad', 'sector-86', 'sector-88', 'surajkund', 'ballabgarh', 'badkhal', 'old-faridabad', 'chhattarpur', 'saket', 'sarita-vihar', 'badarpur', 'noida-sector-18', 'noida-sector-62', 'sohna-road', 'mg-road', 'indirapuram'];
    const areaRow = (aid) => q.get('SELECT a.*, c.name AS city_name, c.state FROM areas a JOIN cities c ON c.id = a.city_id WHERE a.id = ?', aid);

    insert('users', { id: 'usr_owner2', role: 'business', name: 'Sunita Aggarwal', email: 'partners@celebrations.in', phone: '9811000222', password_hash: hashPassword('Business@123'), created_at: now });
    insert('businesses', { id: 'biz_celebrations', owner_user_id: 'usr_owner2', type: 'venue', name: 'NCR Celebrations Group', owner_name: 'Sunita Aggarwal', phone: '9811000222', email: 'partners@celebrations.in', gstin: '06AAECN5678K1Z2', bank_holder: 'NCR Celebrations Group', bank_account_enc: encrypt('00112233445566'), bank_account_last4: '5566', bank_ifsc: 'ICIC0000456', address: 'Sector 16, Faridabad', city: 'Faridabad', state: 'Haryana', pincode: '121002', status: 'APPROVED', commission_bps: 1000, created_at: now, submitted_at: now, approved_at: now });
    insert('business_users', { business_id: 'biz_celebrations', user_id: 'usr_owner2', role: 'owner' });

    const venueIds = ['ven_royal'];
    let placeIdx = 0;
    for (const [type, names] of Object.entries(NAMES)) {
      for (const name of names) {
        const aid = PLACES[placeIdx++ % PLACES.length];
        const a = areaRow(aid);
        const vid = `ven_${name.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 40);
        const jitter = () => (rand() - 0.5) * 0.012;
        const facilities = [...new Set([...BASE_FACILITIES[type], ...EXTRA.filter(() => rand() < 0.35)])];
        const premium = rand();
        const scale = type === 'party_hall' ? 0.35 : type === 'conference_hall' ? 0.5 : type === 'farmhouse' || type === 'resort' ? 1.4 : type === 'hotel' ? 1.25 : 1;
        const tierMul = premium > 0.8 ? 2.2 : premium > 0.5 ? 1.3 : 0.8;
        insert('venues', {
          id: vid, business_id: 'biz_celebrations', name, venue_type: type,
          description: `${name} is a ${type.replace('_', ' ')} in ${a.name}, ${a.city_name}, known for ${pick(['warm hospitality', 'its signature North Indian cuisine', 'elegant interiors', 'a spacious layout and easy parking', 'transparent pricing and punctual service', 'beautiful evening lighting'])}. ${pick(['Ideal for families planning intimate functions and grand celebrations alike.', 'Hosts over a hundred events every season.', 'Just off the main road with easy access from the metro.', 'Run by a family that has hosted weddings in NCR for two decades.'])}`,
          address: `${between(1, 250)}, ${a.name}, ${a.city_name}, ${a.state} ${a.pincode}`,
          area_id: a.id, area_name: a.name, city: a.city_name, state: a.state, pincode: a.pincode,
          lat: a.lat + jitter(), lng: a.lng + jitter(), location_verified: 1,
          event_types: TYPES_EVENTS[type], facilities,
          parking_cars: facilities.includes('parking') ? between(3, 30) * 10 : 0,
          rooms: facilities.includes('rooms') ? between(4, 40) : 0,
          policies: ['Music until 11 PM', pick(['Outside caterers allowed with a ₹15,000 fee', 'Outside caterers not permitted']), 'Security deposit refundable after the event'],
          cancellation_policy: rand() < 0.3 ? [{ min_days: 60, refund_pct: 100, label: '60+ days before event' }, { min_days: 30, refund_pct: 75, label: '30–59 days before' }, { min_days: 10, refund_pct: 25, label: '10–29 days before' }, { min_days: 0, refund_pct: 0, label: 'Less than 10 days' }] : DEFAULT_CANCELLATION_POLICY,
          advance_pct: pick([10, 20, 20, 25, 30]),
          booking_mode: rand() < 0.15 ? 'request' : 'instant',
          status: 'PUBLISHED', cover_hue: between(0, 359),
          created_at: addDays(today, -between(10, 700)) + 'T00:00:00.000Z',
          published_at: addDays(today, -between(1, 500)) + 'T00:00:00.000Z',
        });
        const nSpaces = type === 'party_hall' || type === 'conference_hall' ? between(1, 2) : between(1, 3);
        const spaceNames = { banquet: ['Main Hall', 'Mini Hall', 'Terrace'], lawn: ['Main Lawn', 'Garden Court', 'Mandap Lawn'], farmhouse: ['Farm Lawn', 'Pool Deck', 'Barn Hall'], hotel: ['Ballroom', 'Board Room', 'Poolside'], resort: ['Lakeside Lawn', 'Convention Hall', 'Pool Deck'], party_hall: ['Party Floor', 'Rooftop'], conference_hall: ['Auditorium', 'Breakout Room'] }[type];
        const kinds = { banquet: ['indoor', 'indoor', 'rooftop'], lawn: ['outdoor', 'outdoor', 'outdoor'], farmhouse: ['outdoor', 'poolside', 'indoor'], hotel: ['indoor', 'indoor', 'poolside'], resort: ['outdoor', 'indoor', 'poolside'], party_hall: ['indoor', 'rooftop'], conference_hall: ['indoor', 'indoor'] }[type];
        for (let i = 0; i < nSpaces; i++) {
          const cap = type === 'party_hall' ? between(4, 15) * 10 : type === 'conference_hall' ? between(10, 50) * 10 : type === 'lawn' || type === 'farmhouse' || type === 'resort' ? between(30, 150) * 10 : between(15, 80) * 10;
          const capI = i === 0 ? cap : Math.max(40, round(cap * (0.3 + rand() * 0.4), 10));
          const morning = round((20000 + capI * 90) * scale * tierMul * (0.85 + rand() * 0.3));
          const evening = round(morning * (1.15 + rand() * 0.25));
          insert('venue_spaces', {
            id: `${vid.replace('ven_', 'spc_')}_${i}`.slice(0, 48), venue_id: vid, name: spaceNames[i], kind: kinds[i],
            capacity_seated: Math.round(capI * 0.7), capacity_floating: capI, min_guests: Math.round(capI * 0.2 / 10) * 10,
            price_morning: morning, price_evening: evening, price_full_day: round((morning + evening) * 0.85),
            weekend_surcharge_pct: pick([0, 0, 10, 15, 20]), facilities: [], description: '', active: 1, sort: i,
          });
        }
        const perPlate = pick([650, 750, 850, 950, 1100, 1400, 1800]);
        const pk = [
          { name: 'Essential', tier: 'essential', pricing_mode: 'included', price: 0, inclusions: [{ code: 'venue', label: 'Venue rental' }, { code: 'furniture', label: 'Standard seating' }, { code: 'lighting', label: 'House lighting' }] },
          { name: 'Premium', tier: 'premium', pricing_mode: 'flat', price: round(35000 * scale * tierMul, 5000), inclusions: [{ code: 'venue', label: 'Venue rental' }, { code: 'decoration', label: 'Theme décor' }, { code: 'sound', label: 'Sound system' }, { code: 'lighting', label: 'Mood lighting' }, { code: 'furniture', label: 'Premium furniture' }] },
        ];
        if (type !== 'conference_hall') pk.push({ name: `Buffet ₹${perPlate}/plate`, tier: 'custom', pricing_mode: 'per_plate', price: perPlate, min_guests: 50, inclusions: [{ code: 'venue', label: 'Venue rental' }, { code: 'catering', label: `${between(14, 32)}-dish buffet` }, { code: 'furniture', label: 'Banquet seating' }] });
        if (premium > 0.5) pk.push({ name: 'Luxury', tier: 'luxury', pricing_mode: 'flat', price: round(110000 * scale * tierMul, 5000), inclusions: [{ code: 'venue', label: 'Venue rental' }, { code: 'decoration', label: 'Designer décor' }, { code: 'dj', label: 'DJ & dance floor' }, { code: 'lighting', label: 'Lighting rig' }, { code: 'furniture', label: 'Lounge furniture' }, { code: 'photography', label: 'Photography' }] });
        pk.forEach((p, i) => insert('venue_packages', { id: `${vid.replace('ven_', 'pkg_')}_${i}`.slice(0, 48), venue_id: vid, min_guests: 0, description: '', ...p, sort: i, active: 1 }));
        const sv = [
          ['catering', 'Catering (per guest)', 'per_guest', pick([250, 300, 350, 450])],
          ['decoration', 'Floral decoration', 'flat', round(25000 * tierMul, 5000)],
          ['dj', 'DJ & sound', 'flat', pick([12000, 15000, 18000, 25000])],
          ['photography', 'Photography', 'flat', pick([25000, 35000, 45000])],
        ];
        sv.forEach(([category, sname, mode, price], i) => insert('services', { id: `${vid.replace('ven_', 'svc_')}_${i}`.slice(0, 48), venue_id: vid, category, name: sname, pricing_mode: mode, price, description: '', active: 1, sort: i }));
        recomputeVenueAggregates(vid);
        venueIds.push(vid);
      }
    }

    // ── Bookings: past (completed + reviewed) and future (calendar variety) ──
    let seq = 0;
    const REVIEW_TEXT = [
      [5, 'Everything was perfectly managed — food was the highlight and the staff were very courteous to our elders.'],
      [5, 'Beautiful venue, exactly like the photos. The manager handled every last-minute change calmly.'],
      [4, 'Great space and decor. Parking got a bit crowded at peak time but valet helped.'],
      [4, 'Good value for money. Food was tasty; would have liked more variety in desserts.'],
      [5, 'Our guests are still talking about the lawn setup. Transparent billing, no surprise charges.'],
      [3, 'Venue is nice but the AC in the hall was weak for the first hour.'],
      [4, 'Smooth booking through the app and the advance was adjusted correctly in the final bill.'],
      [5, 'Hosted our company offsite here — projector, Wi-Fi and lunch all went smoothly.'],
      [2, 'Decoration was not as promised; the team did fix it after we complained, but it took time.'],
      [4, 'Lovely ambience and helpful staff. Sound system could be better.'],
    ];
    const mkBooking = ({ venueId, spaceId, date, slot, guests, eventType, customerId, status, review }) => {
      const space = q.get('SELECT * FROM venue_spaces WHERE id = ?', spaceId);
      const venue = q.get('SELECT * FROM venues WHERE id = ?', venueId);
      const cust = q.get('SELECT * FROM users WHERE id = ?', customerId);
      const venueAmt = slot === 'MORNING' ? space.price_morning : slot === 'EVENING' ? space.price_evening : space.price_full_day;
      const catering = 300 * guests;
      const subtotal = venueAmt + catering;
      const tax = Math.round(subtotal * 0.18);
      const total = subtotal + tax;
      const advance = Math.ceil(total * venue.advance_pct / 100);
      const bid = `bkg_seed_${++seq}`;
      const code = `EVT-${date.replaceAll('-', '')}-${String(90000 + seq).padStart(5, '0')}`;
      const createdAt = addDays(date < today ? date : today, date < today ? -between(20, 90) : -between(1, 60)) + 'T10:00:00.000Z';
      insert('bookings', {
        id: bid, code, customer_id: customerId, venue_id: venueId, space_id: spaceId, business_id: venue.business_id,
        event_type: eventType, event_date: date, slot, guests, status, source: 'online',
        customer_name: cust.name, customer_phone: cust.phone, subtotal, tax, total, advance_amount: advance, paid_amount: advance,
        commission_bps: 1000, cancellation_policy: JSON.parse(venue.cancellation_policy), created_at: createdAt, confirmed_at: createdAt,
        completed_at: status === 'COMPLETED' ? date + 'T23:30:00.000Z' : null,
      });
      insert('booking_items', { id: id('bi'), booking_id: bid, kind: 'venue', ref_id: spaceId, label: `Venue — ${space.name}`, qty: 1, unit_price: venueAmt, amount: venueAmt });
      insert('booking_items', { id: id('bi'), booking_id: bid, kind: 'service', label: 'Catering', detail: `₹300 × ${guests} guests`, qty: guests, unit_price: 300, amount: catering });
      insert('booking_items', { id: id('bi'), booking_id: bid, kind: 'tax', label: 'GST 18%', qty: 1, unit_price: tax, amount: tax });
      for (const [f, t] of [[null, 'PENDING_PAYMENT'], ['PENDING_PAYMENT', 'PAYMENT_PROCESSING'], ['PAYMENT_PROCESSING', 'CONFIRMED']]) {
        insert('booking_status_history', { id: id('bsh'), booking_id: bid, from_status: f, to_status: t, actor_role: 'system', note: 'Seeded', at: createdAt });
      }
      const pay = { id: `pay_seed_${seq}`, booking_id: bid, purpose: 'advance', amount: advance, currency: 'INR', status: 'CAPTURED', gateway: 'sandbox', gateway_order_id: `order_seed_${seq}`, gateway_payment_id: `gpay_seed_${seq}`, method: pick(['upi', 'upi', 'card', 'netbanking']), created_at: createdAt, verified_at: createdAt };
      insert('payments', pay);
      insert('sandbox_gateway_orders', { order_id: pay.gateway_order_id, amount_paise: advance * 100, receipt: code, status: 'paid', payment_id: pay.gateway_payment_id, method: pay.method, created_at: createdAt, updated_at: createdAt });
      const b = q.get('SELECT * FROM bookings WHERE id = ?', bid);
      postCapture(pay, b);
      const { commission, payable } = computeCommission(b);
      q.run('UPDATE bookings SET commission_amount = ?, business_payable = ? WHERE id = ?', commission, payable, bid);
      q.run('UPDATE venues SET booking_count = booking_count + 1 WHERE id = ?', venueId);
      if (status === 'COMPLETED') {
        insert('booking_status_history', { id: id('bsh'), booking_id: bid, from_status: 'CONFIRMED', to_status: 'COMPLETED', actor_role: 'system', note: 'Seeded', at: date + 'T23:30:00.000Z' });
        recognise(q.get('SELECT * FROM bookings WHERE id = ?', bid));
        if (review) {
          const [stars, body] = review;
          const sub = () => Math.max(1, Math.min(5, stars + pick([-1, 0, 0, 0, 1])));
          insert('reviews', { id: id('rev'), booking_id: bid, venue_id: venueId, customer_id: customerId, overall: stars, venue_rating: sub(), food: sub(), service: sub(), cleanliness: sub(), value: sub(), body, status: 'PUBLISHED', created_at: addDays(date, between(1, 5)) + 'T12:00:00.000Z' });
        }
      } else {
        const g = id('hg');
        for (const unit of slot === 'MORNING' ? ['AM'] : slot === 'EVENING' ? ['PM'] : ['AM', 'PM']) {
          insert('inventory_holds', { id: id('hold'), space_id: spaceId, date, unit, kind: 'BOOKING', booking_id: bid, group_id: g, created_at: createdAt });
        }
      }
      return bid;
    };

    const custIds = customers.map((c) => c[0]);
    const EVENTS_BY = (v) => JSON.parse(q.get('SELECT event_types FROM venues WHERE id = ?', v).event_types);
    for (const vid of venueIds) {
      const spaces = q.all('SELECT * FROM venue_spaces WHERE venue_id = ?', vid);
      const pastCount = vid === 'ven_royal' ? 14 : between(2, 9);
      for (let i = 0; i < pastCount; i++) {
        const sp = pick(spaces);
        mkBooking({ venueId: vid, spaceId: sp.id, date: addDays(today, -between(5, 330)), slot: pick(['MORNING', 'EVENING', 'EVENING', 'FULL_DAY']), guests: Math.max(sp.min_guests, round(sp.capacity_floating * (0.5 + rand() * 0.45), 10)), eventType: pick(EVENTS_BY(vid)), customerId: pick(custIds), status: 'COMPLETED', review: rand() < 0.85 ? pick(REVIEW_TEXT) : null });
      }
      // Future bookings; each (space, date, unit) at most once.
      const futureCount = vid === 'ven_royal' ? 0 : between(3, 12);
      const used = new Set();
      for (let i = 0; i < futureCount; i++) {
        const sp = pick(spaces);
        const date = addDays(today, between(2, 120));
        const slot = pick(['MORNING', 'EVENING', 'EVENING', 'FULL_DAY']);
        const units = slot === 'MORNING' ? ['AM'] : slot === 'EVENING' ? ['PM'] : ['AM', 'PM'];
        if (units.some((u) => used.has(`${sp.id}|${date}|${u}`))) continue;
        units.forEach((u) => used.add(`${sp.id}|${date}|${u}`));
        mkBooking({ venueId: vid, spaceId: sp.id, date, slot, guests: Math.max(sp.min_guests, round(sp.capacity_floating * 0.7, 10)), eventType: pick(EVENTS_BY(vid)), customerId: pick(custIds), status: 'CONFIRMED' });
      }
      recomputeRating(vid);
    }

    // Royal Garden: a busy Sept–Oct so the calendar shows every state.
    // 27 Sep: Grand Hall evening booked, Grand Hall morning free → "limited" → still bookable (spec journey).
    const sep = (d) => `${today.slice(0, 4)}-09-${String(d).padStart(2, '0')}`;
    const futureRoyal = [
      [sep(23), 'spc_grand', 'FULL_DAY'], [sep(25), 'spc_grand', 'FULL_DAY'], [sep(25), 'spc_crystal', 'FULL_DAY'], [sep(25), 'spc_lawn', 'FULL_DAY'],
      [sep(26), 'spc_lawn', 'EVENING'], [sep(26), 'spc_grand', 'EVENING'], [sep(27), 'spc_lawn', 'EVENING'], [sep(28), 'spc_crystal', 'MORNING'],
      [addDays(today, 18), 'spc_grand', 'EVENING'], [addDays(today, 25), 'spc_lawn', 'FULL_DAY'], [addDays(today, 40), 'spc_grand', 'FULL_DAY'],
    ];
    for (const [date, spaceId, slot] of futureRoyal) {
      if (date <= today) continue;
      const sp = q.get('SELECT * FROM venue_spaces WHERE id = ?', spaceId);
      mkBooking({ venueId: 'ven_royal', spaceId, date, slot, guests: Math.max(sp.min_guests, round(sp.capacity_floating * 0.8, 10)), eventType: pick(['wedding', 'reception', 'engagement']), customerId: pick(custIds.slice(1)), status: 'CONFIRMED' });
    }
    // An owner-entered offline booking + a maintenance block.
    const off = addDays(today, 9);
    insert('bookings', { id: 'bkg_seed_offline', code: `EVT-${off.replaceAll('-', '')}-80001`, venue_id: 'ven_royal', space_id: 'spc_crystal', business_id: 'biz_royal', event_type: 'birthday', event_date: off, slot: 'EVENING', guests: 120, status: 'CONFIRMED', source: 'offline', source_channel: 'whatsapp', customer_name: 'Mohit Arora', customer_phone: '9899112233', subtotal: 110000, total: 110000, created_at: now, confirmed_at: now });
    insert('booking_status_history', { id: id('bsh'), booking_id: 'bkg_seed_offline', to_status: 'CONFIRMED', actor_id: 'usr_owner', actor_role: 'business', note: 'Offline booking via whatsapp; inventory blocked', at: now });
    insert('inventory_holds', { id: id('hold'), space_id: 'spc_crystal', date: off, unit: 'PM', kind: 'OFFLINE', booking_id: 'bkg_seed_offline', group_id: id('hg'), created_by: 'usr_owner', created_at: now });
    const mDate = addDays(today, 12);
    insert('inventory_holds', { id: id('hold'), space_id: 'spc_lawn', date: mDate, unit: 'AM', kind: 'MAINTENANCE', group_id: 'hg_maint_seed', note: 'Lawn re-turfing', created_by: 'usr_owner', created_at: now });
    insert('inventory_holds', { id: id('hold'), space_id: 'spc_lawn', date: mDate, unit: 'PM', kind: 'MAINTENANCE', group_id: 'hg_maint_seed', note: 'Lawn re-turfing', created_by: 'usr_owner', created_at: now });

    // Past payouts for the demo business so finance screens have history.
    const batch = createPayouts('usr_fin', 'biz_royal');
    if (batch[0]) markPayoutPaid(batch[0].id, 'UTR' + String(between(100000000, 999999999)));
    // Leave the second business with an eligible, unpaid balance.

    // ── A business waiting for verification ──
    insert('users', { id: 'usr_owner3', role: 'business', name: 'Harpreet Kaur', email: 'hello@sukhfarms.in', phone: '9811000333', password_hash: hashPassword('Business@123'), created_at: now });
    insert('businesses', { id: 'biz_sukh', owner_user_id: 'usr_owner3', type: 'venue', name: 'Sukh Farms & Lawns', owner_name: 'Harpreet Kaur', phone: '9811000333', email: 'hello@sukhfarms.in', gstin: '06AAKFS4321M1Z9', pan_enc: encrypt('AAKFS4321M'), bank_holder: 'Sukh Farms & Lawns', bank_account_enc: encrypt('912010034567812'), bank_account_last4: '7812', bank_ifsc: 'UTIB0000789', address: 'Village Pali, Surajkund Road', city: 'Faridabad', state: 'Haryana', pincode: '121009', status: 'SUBMITTED', commission_bps: 1000, created_at: now, submitted_at: now });
    insert('business_users', { business_id: 'biz_sukh', user_id: 'usr_owner3', role: 'owner' });
    insert('verification_events', { id: id('ver'), entity_type: 'business', entity_id: 'biz_sukh', from_status: 'DRAFT', to_status: 'SUBMITTED', actor_id: 'usr_owner3', at: now });
    insert('venues', { id: 'ven_sukh', business_id: 'biz_sukh', name: 'Sukh Farms', venue_type: 'farmhouse', description: 'A 3-acre farmhouse on Surajkund Road with a mango orchard lawn, a covered pavilion and six cottages for overnight guests.', address: 'Village Pali, Surajkund Road, Faridabad 121009', area_id: 'surajkund', area_name: 'Surajkund', city: 'Faridabad', state: 'Haryana', pincode: '121009', lat: 28.4795, lng: 77.2902, location_verified: 0, event_types: ['wedding', 'reception', 'engagement', 'party', 'corporate'], facilities: ['parking', 'rooms', 'catering', 'decoration', 'dj', 'generator', 'alcohol'], parking_cars: 200, rooms: 6, policies: ['Music until 10 PM'], cancellation_policy: DEFAULT_CANCELLATION_POLICY, advance_pct: 25, status: 'SUBMITTED', cover_hue: 110, created_at: now });
    insert('venue_spaces', { id: 'spc_sukh_orchard', venue_id: 'ven_sukh', name: 'Orchard Lawn', kind: 'outdoor', capacity_seated: 600, capacity_floating: 900, min_guests: 150, price_morning: 120000, price_evening: 175000, price_full_day: 260000, weekend_surcharge_pct: 15, active: 1, sort: 0 });
    insert('venue_packages', { id: 'pkg_sukh_ess', venue_id: 'ven_sukh', name: 'Essential', tier: 'essential', pricing_mode: 'included', price: 0, inclusions: [{ code: 'venue', label: 'Venue rental' }], active: 1, sort: 0 });
    recomputeVenueAggregates('ven_sukh');
    insert('verification_events', { id: id('ver'), entity_type: 'venue', entity_id: 'ven_sukh', from_status: 'DRAFT', to_status: 'SUBMITTED', actor_id: 'usr_owner3', at: now });
    // A tiny valid PDF as the uploaded GST certificate.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj 4 0 obj<</Length 60>>stream\nBT /F1 14 Tf 20 70 Td (GST Certificate - Sukh Farms) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
    const key = `biz_sukh/seed-gst.pdf`;
    fs.mkdirSync(path.join(config.storageDir, 'private', 'biz_sukh'), { recursive: true });
    fs.writeFileSync(path.join(config.storageDir, 'private', key), pdf);
    insert('business_documents', { id: 'doc_sukh_gst', business_id: 'biz_sukh', kind: 'gst_certificate', file_name: 'gst-certificate.pdf', mime: 'application/pdf', storage_key: key, status: 'PENDING', uploaded_at: now });
    fs.writeFileSync(path.join(config.storageDir, 'private', 'biz_sukh', 'seed-noc.pdf'), pdf);
    insert('business_documents', { id: 'doc_sukh_noc', business_id: 'biz_sukh', kind: 'fire_noc', file_name: 'fire-noc.pdf', mime: 'application/pdf', storage_key: 'biz_sukh/seed-noc.pdf', status: 'PENDING', uploaded_at: now });
  });

  const counts = {
    venues: q.get("SELECT COUNT(*) c FROM venues WHERE status = 'PUBLISHED'").c,
    bookings: q.get('SELECT COUNT(*) c FROM bookings').c,
    reviews: q.get('SELECT COUNT(*) c FROM reviews').c,
    unbalanced: q.get('SELECT COUNT(*) c FROM (SELECT txn_id FROM financial_ledger GROUP BY txn_id HAVING SUM(debit) != SUM(credit))').c,
  };
  if (!quiet) {
    console.log('Seeded', counts);
    console.log(`
Accounts (development only)
  Customer app : phone 9876543210 (OTP is returned by the API in dev)
  Business     : owner@royalgarden.in / Business@123    (Royal Garden Banquet)
                 hello@sukhfarms.in / Business@123      (awaiting verification)
  Admin        : admin@pandal.dev / Admin@12345  (super_admin)
                 finance@pandal.dev / Finance@12345, ops@pandal.dev / Ops@123456
  Admin 2FA    : TOTP secret ${DEV_ADMIN_TOTP_SECRET}  → current code ${totpNow(DEV_ADMIN_TOTP_SECRET)}  (npm run totp)`);
  }
  return counts;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/db/seed.js')) seed();
