const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹3,25,000 (Indian digit grouping). */
export const money = (n: number | null | undefined) => (n == null || Number.isNaN(Number(n)) ? '—' : `${Number(n) < 0 ? '−' : ''}₹${inr.format(Math.abs(Number(n)))}`);
export const num = (n: number | null | undefined) => (n == null ? '—' : inr.format(Number(n)));

/** Compact money for chart labels: ₹3.2L, ₹1.1Cr, ₹45K. */
export function moneyShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `₹${Math.round(n / 1e3)}K`;
  return `₹${n}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-09-27" → "27 Sep 2026". ISO timestamps are shown in IST. */
export function date(s: string | null | undefined) {
  if (!s) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return s;
  const ist = new Date(t.getTime() + 330 * 60_000);
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

/** "27 Sep 2026, 4:05 PM" in IST. */
export function dateTime(s: string | null | undefined) {
  if (!s) return '—';
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return s;
  const ist = new Date(t.getTime() + 330 * 60_000);
  let h = ist.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${h}:${String(ist.getUTCMinutes()).padStart(2, '0')} ${ap}`;
}

export function weekday(d: string) {
  const [y, m, dd] = d.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
}

export function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Today's date in IST as YYYY-MM-DD. */
export function todayIst() {
  const t = new Date(Date.now() + 330 * 60_000);
  return t.toISOString().slice(0, 10);
}

export const titleCase = (s: string | null | undefined) =>
  (s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export const pct = (bps: number | null | undefined) => (bps == null ? '—' : `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`);

/** Media served by the dev backend is proxied, so make it same-origin. */
export const mediaUrl = (u: string | null | undefined) => (u ? u.replace(/^https?:\/\/(localhost|127\.0\.0\.1):4000(?=\/media\/)/, '') : '');

const DOC_LABELS: Record<string, string> = {
  gst_certificate: 'GST certificate',
  pan: 'PAN card',
  trade_license: 'Trade licence',
  fire_noc: 'Fire NOC',
  property_proof: 'Property proof',
  cancelled_cheque: 'Cancelled cheque',
  other: 'Other document',
};
export const docLabel = (k: string) => DOC_LABELS[k] || titleCase(k);
