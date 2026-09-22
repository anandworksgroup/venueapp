// Shapes returned by the Pandal API (see docs/API.md).

export type Slot = 'MORNING' | 'EVENING' | 'FULL_DAY';

export interface Meta {
  event_categories: { code: string; name: string; icon: string }[];
  venue_types: { code: string; name: string }[];
  facilities: { code: string; name: string }[];
  slots: { code: Slot; label: string; time: string }[];
  image_categories: string[];
  service_categories: string[];
  business_types: string[];
  document_kinds: string[];
  today: string;
}

export interface User {
  id: string;
  role: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  admin_role?: string | null;
}

export interface Business {
  id: string;
  type: string;
  name: string;
  legal_name: string | null;
  owner_name: string;
  phone: string;
  email: string | null;
  gstin: string | null;
  has_pan: boolean;
  bank_holder: string | null;
  bank_ifsc: string | null;
  bank_account_masked: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  status: string;
  rejection_reason: string | null;
  commission_bps: number;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
}

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

export interface BusinessDoc {
  id: string;
  kind: string;
  file_name: string;
  status: string;
  note: string | null;
  uploaded_at: string;
  mime?: string;
}

export interface BusinessMe {
  business: Business | null;
  venues?: { id: string; name: string; status: string }[];
  documents?: BusinessDoc[];
  checklist: ChecklistItem[] | null;
  user: User;
}

export interface CancellationRule {
  min_days: number;
  refund_pct: number;
  label: string;
}

export interface SpaceRow {
  id: string;
  venue_id: string;
  name: string;
  kind: string;
  description: string;
  capacity_seated: number;
  capacity_floating: number;
  min_guests: number;
  price_morning: number;
  price_evening: number;
  price_full_day: number;
  weekend_surcharge_pct: number;
  facilities: string[];
  active: number;
}

export interface Inclusion {
  code: string;
  label: string;
}

export interface PackageRow {
  id: string;
  name: string;
  tier: string;
  pricing_mode: 'included' | 'flat' | 'per_plate';
  price: number;
  min_guests: number;
  inclusions: Inclusion[];
  description: string;
  active: number;
}

export interface ServiceRow {
  id: string;
  venue_id: string | null;
  category: string;
  name: string;
  description: string;
  pricing_mode: 'flat' | 'per_guest';
  price: number;
  active: number;
}

export interface GalleryItem {
  id: string;
  url: string;
  category: string;
  media_type: string;
  caption: string | null;
  space_id: string | null;
}

export interface VenueDetail {
  id: string;
  name: string;
  venue_type: string;
  venue_type_label: string;
  description: string;
  address: string | null;
  area: string | null;
  city: string | null;
  state?: string | null;
  pincode?: string | null;
  lat: number | null;
  lng: number | null;
  location_verified: boolean;
  booking_mode: 'instant' | 'request';
  advance_pct: number;
  event_types: string[];
  facilities: string[];
  facility_labels: { code: string; label: string }[];
  capacity: { indoor: number | null; outdoor: number | null; dining: number | null; parking_cars: number | null; rooms: number | null; max_guests: number | null };
  starting_price: number | null;
  rating_avg: number;
  rating_count: number;
  cover_hue: number;
  cover_image: string | null;
  business_name: string | null;
  spaces: {
    id: string;
    name: string;
    kind: string;
    description: string;
    capacity_seated: number;
    capacity_floating: number;
    min_guests: number;
    weekend_surcharge_pct: number;
    prices: Record<Slot, number>;
  }[];
  gallery: GalleryItem[];
  packages: (Omit<PackageRow, 'active'> & { active?: number })[];
  services: ServiceRow[];
  policies: string[];
  cancellation_policy: CancellationRule[];
  status: string;
  rejection_reason: string | null;
  // Business view only
  all_spaces?: SpaceRow[];
  all_packages?: PackageRow[];
  all_services?: ServiceRow[];
  parking_cars?: number;
  rooms?: number;
}

export interface Booking {
  id: string;
  code: string;
  status: string;
  status_label: string;
  source: string;
  source_channel: string | null;
  event_type: string;
  event_date: string;
  slot: Slot;
  slot_label: string;
  slot_time: string;
  guests: number;
  venue: { id: string; name: string; address: string | null; area: string | null; city: string | null } | null;
  space: { id: string; name: string };
  package: { id: string; name: string } | null;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  advance_amount: number;
  paid_amount: number;
  refunded_amount: number;
  balance_amount: number;
  hold_expires_at: string | null;
  created_at: string;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason?: string | null;
  commission_amount?: number;
  business_payable?: number;
  payout_status?: string;
}

export interface BookingFull extends Booking {
  items: { kind: string; label: string; detail: string | null; qty: number; unit_price: number; amount: number }[];
  history: { from_status: string | null; to_status: string; actor_role: string | null; note: string | null; at: string }[];
  payments: { id: string; purpose: string; amount: number; status: string; gateway: string; gateway_order_id: string; gateway_payment_id: string | null; method: string | null; created_at: string; verified_at: string | null }[];
  refunds: { id: string; amount: number; status: string; policy_rule: string | null; created_at: string; processed_at: string | null }[];
  cancellation_policy: CancellationRule[];
  cancellation: { cancellable: boolean; days_before: number; rule: CancellationRule | null; refund_amount: number; retained_amount: number } | null;
  notes: string | null;
  customer_email?: string | null;
  review: { id: string; overall: number; body: string | null; created_at: string } | null;
}

export interface Message {
  id: string;
  sender_role: string;
  body: string;
  at: string;
}

export interface CalendarCell {
  kind: 'RESERVATION' | 'BOOKING' | 'OFFLINE' | 'BLOCK' | 'MAINTENANCE';
  group_id: string;
  booking_id: string | null;
  code: string | null;
  status: string | null;
  event_type: string | null;
  customer_name: string | null;
  guests: number | null;
  note: string | null;
  source?: string | null;
}

export interface CalendarDay {
  date: string;
  past: boolean;
  status: 'available' | 'partial' | 'booked' | 'unavailable';
  spaces: { space_id: string; AM: CalendarCell | null; PM: CalendarCell | null }[];
}

export interface CalendarResp {
  venue_id?: string;
  month: string;
  spaces: { id: string; name: string; kind: string; capacity_floating: number }[];
  days: CalendarDay[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface VerificationEvent {
  id: string;
  entity_type: 'business' | 'venue';
  entity_id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  note: string | null;
  at: string;
}
