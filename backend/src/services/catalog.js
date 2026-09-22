// Platform vocabulary shared by all three products. Event categories live in
// the DB (admin-managed); these defaults seed it.

export const DEFAULT_EVENT_CATEGORIES = [
  ['wedding', 'Wedding', 'ring'],
  ['reception', 'Reception', 'champagne'],
  ['engagement', 'Engagement', 'hearts'],
  ['birthday', 'Birthday', 'cake'],
  ['anniversary', 'Anniversary', 'gift'],
  ['corporate', 'Corporate Event', 'briefcase'],
  ['conference', 'Conference', 'mic'],
  ['seminar', 'Seminar', 'easel'],
  ['party', 'Party', 'confetti'],
  ['baby_shower', 'Baby Shower', 'baby'],
  ['kitty_party', 'Kitty Party', 'cards'],
  ['farewell', 'Farewell', 'wave'],
  ['exhibition', 'Exhibition', 'gallery'],
  ['religious', 'Religious Event', 'diya'],
  ['other', 'Other', 'sparkle'],
];

export const VENUE_TYPES = [
  ['banquet', 'Banquet'],
  ['lawn', 'Lawn'],
  ['farmhouse', 'Farmhouse'],
  ['hotel', 'Hotel'],
  ['resort', 'Resort'],
  ['party_hall', 'Party Hall'],
  ['conference_hall', 'Conference Hall'],
];

export const FACILITIES = [
  ['parking', 'Parking'],
  ['ac', 'AC'],
  ['rooms', 'Rooms'],
  ['catering', 'Catering'],
  ['decoration', 'Decoration'],
  ['dj', 'DJ'],
  ['generator', 'Power backup'],
  ['stage', 'Stage'],
  ['bridal_room', 'Bridal Room'],
  ['valet', 'Valet'],
  ['wifi', 'Wi-Fi'],
  ['projector', 'Projector'],
  ['wheelchair', 'Wheelchair access'],
  ['alcohol', 'Alcohol permitted'],
];

export const SLOTS = {
  MORNING: { label: 'Morning', time: '08:00–14:00', units: ['AM'] },
  EVENING: { label: 'Evening', time: '17:00–23:00', units: ['PM'] },
  FULL_DAY: { label: 'Full Day', time: '08:00–23:00', units: ['AM', 'PM'] },
};

export const GUEST_BUCKETS = [
  { label: '<100', min: 1, max: 99 },
  { label: '100–250', min: 100, max: 250 },
  { label: '250–500', min: 250, max: 500 },
  { label: '500–1000', min: 500, max: 1000 },
  { label: '1000+', min: 1000, max: null },
];

export const BUDGET_OPTIONS = [25000, 50000, 100000, 200000, 500000];

export const RADIUS_OPTIONS = [1, 5, 10, 25, 50];

export const SORTS = [
  ['distance', 'Distance'],
  ['price_asc', 'Price: Low to High'],
  ['price_desc', 'Price: High to Low'],
  ['rating', 'Rating'],
  ['reviews', 'Most Reviewed'],
  ['newest', 'Recently Added'],
  ['availability', 'Availability'],
];

export const IMAGE_CATEGORIES = ['exterior', 'main_hall', 'lawn', 'stage', 'dining', 'rooms', 'parking', 'decoration'];

export const SERVICE_CATEGORIES = ['catering', 'decoration', 'dj', 'photography', 'invitation', 'other'];

export const BUSINESS_TYPES = ['venue', 'catering', 'decoration', 'photography', 'other'];

export const DOCUMENT_KINDS = ['gst_certificate', 'pan', 'trade_license', 'fire_noc', 'property_proof', 'cancelled_cheque', 'other'];

export const DEFAULT_CANCELLATION_POLICY = [
  { min_days: 30, refund_pct: 90, label: '30+ days before event' },
  { min_days: 15, refund_pct: 70, label: '15–29 days before' },
  { min_days: 7, refund_pct: 40, label: '7–14 days before' },
  { min_days: 0, refund_pct: 0, label: 'Less than 7 days' },
];
