import { Link } from 'react-router-dom';
import { adminApi } from '../api';
import { BarChart, HBars } from '../shared/BarChart';
import { money, moneyShort, num, titleCase } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { Async, Card, PageHeader, Stat } from '../ui';

interface Dash {
  gmv: number;
  collected: number;
  platform_revenue: number;
  commission_booked: number;
  bookings: number;
  bookings_today: number;
  customers: number;
  businesses: number;
  venues: number;
  pending_verification: number;
  pending_payout: number;
  pending_refunds: { c: number; v: number };
  open_disputes: number;
  by_status: { status: string; c: number }[];
  daily: { d: string; bookings: number; collected: number }[];
  top_cities: { city: string | null; c: number }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** Fill missing days so the 30-day chart has a stable x-axis. */
function last30(daily: Dash['daily']) {
  const by = Object.fromEntries(daily.map((x) => [x.d, x]));
  const out: Dash['daily'] = [];
  const now = new Date(Date.now() + 330 * 60_000);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    out.push(by[d] || { d, bookings: 0, collected: 0 });
  }
  return out;
}

export function AdminDashboard() {
  const state = useAsync(() => adminApi.get<Dash>('/admin/dashboard'), []);
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Marketplace health at a glance." />
      <Async state={state}>
        {(d) => {
          const days = last30(d.daily);
          return (
            <div className="stack">
              <div className="grid-4">
                <Stat label="GMV" value={money(d.gmv)} hint="Paid online bookings" tone="teal" />
                <Stat label="Platform revenue" value={money(d.platform_revenue)} hint={`${money(d.commission_booked)} commission booked`} tone="accent" />
                <Stat label="Bookings" value={num(d.bookings)} hint={`${d.bookings_today} created today`} />
                <Stat label="Customers" value={num(d.customers)} />
                <Stat label="Businesses" value={num(d.businesses)} hint={<Link to="/admin/businesses">View all</Link>} />
                <Stat label="Live venues" value={num(d.venues)} hint={<Link to="/admin/venues?status=PUBLISHED">Published</Link>} tone="success" />
                <Stat label="Pending verification" value={num(d.pending_verification)} hint={<Link to="/admin/businesses?status=SUBMITTED">Review queue</Link>} tone={d.pending_verification ? 'warning' : undefined} />
                <Stat label="Pending payout" value={money(d.pending_payout)} hint={<Link to="/admin/payouts">Payouts</Link>} tone={d.pending_payout ? 'warning' : undefined} />
                <Stat label="Pending refunds" value={money(d.pending_refunds.v)} hint={<Link to="/admin/refunds">{d.pending_refunds.c} to process</Link>} tone={d.pending_refunds.c ? 'danger' : undefined} />
                <Stat label="Open disputes" value={num(d.open_disputes)} hint={<Link to="/admin/disputes">Resolve</Link>} tone={d.open_disputes ? 'danger' : undefined} />
              </div>
              <div className="grid-2">
                <Card title="Bookings created · last 30 days">
                  <BarChart data={days.map((x, i) => ({ label: short(x.d), value: x.bookings, highlight: i === days.length - 1 }))} labelEvery={5} showValues={false} height={170} ariaLabel="Bookings per day, last 30 days" />
                </Card>
                <Card title="Collected · last 30 days">
                  <BarChart data={days.map((x, i) => ({ label: short(x.d), value: x.collected, title: `${short(x.d)}: ${money(x.collected)}`, highlight: i === days.length - 1 }))} labelEvery={5} showValues={false} height={170} color="var(--accent)" highlightColor="var(--primary)" format={moneyShort} ariaLabel="Money collected per day, last 30 days" />
                </Card>
              </div>
              <div className="grid-2">
                <Card title="Bookings by status">
                  <HBars data={d.by_status.map((s) => ({ label: titleCase(s.status), value: s.c }))} />
                </Card>
                <Card title="Top cities (live venues)">
                  <HBars data={d.top_cities.map((c) => ({ label: c.city || 'Unknown', value: c.c }))} color="var(--accent)" />
                </Card>
              </div>
            </div>
          );
        }}
      </Async>
    </>
  );
}
