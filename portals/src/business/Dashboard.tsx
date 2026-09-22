import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bizApi } from '../api';
import { BarChart } from '../shared/BarChart';
import { money, titleCase, weekday } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { Icons } from '../shared/icons';
import { StatusPill } from '../shared/StatusPill';
import { Async, Button, Card, EmptyState, PageHeader, Stat } from '../ui';
import type { Booking } from '../types';
import { useBiz } from './context';
import { HoldModal, OfflineBookingModal } from './InventoryModals';

interface DashboardResp {
  today: string;
  new_bookings: number;
  upcoming: number;
  pending_requests: number;
  revenue_month: number;
  collected_month: number;
  next_events: Booking[];
  week: { date: string; bookings: number }[];
  rating: { a: number | null; c: number | null };
  unread_notifications: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function Dashboard() {
  const { me } = useBiz();
  const state = useAsync(() => bizApi.get<DashboardResp>('/business/dashboard'), []);
  const [offline, setOffline] = useState(false);
  const [block, setBlock] = useState(false);
  const navigate = useNavigate();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <PageHeader
        title={`${greet}, ${(me.business?.owner_name || me.user.name || '').split(' ')[0]}`}
        subtitle={`Here's what's happening at ${me.business?.name} today.`}
        actions={
          <>
            <Button variant="secondary" icon={Icons.lock} onClick={() => setBlock(true)}>
              Block date
            </Button>
            <Button variant="accent" icon={Icons.plus} onClick={() => setOffline(true)}>
              Add offline booking
            </Button>
          </>
        }
      />
      <Async state={state}>
        {(d) => (
          <div className="stack">
            <div className="grid-4">
              <Stat label="New bookings" value={d.new_bookings} hint="Confirmed in the last 24 h" tone="teal" />
              <Stat label="Upcoming" value={d.upcoming} hint="Confirmed events ahead" tone="success" />
              <Stat label="Revenue this month" value={money(d.revenue_month)} hint={`${money(d.collected_month)} collected`} tone="accent" />
              <Stat label="Pending requests" value={d.pending_requests} hint={d.pending_requests ? <Link to="/business/bookings?tab=pending">Review now →</Link> : 'All caught up'} tone={d.pending_requests ? 'warning' : undefined} />
            </div>
            <div className="split">
              <Card title="Next events" actions={<Link to="/business/bookings?tab=upcoming" className="btn btn-ghost btn-sm">All upcoming</Link>}>
                {d.next_events.length === 0 ? (
                  <EmptyState title="No upcoming events" body="New bookings show up here as soon as they're confirmed." />
                ) : (
                  <ul className="list">
                    {d.next_events.map((b) => {
                      const [, m, day] = b.event_date.split('-');
                      return (
                        <li key={b.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => navigate(`/business/bookings/${b.id}`)}>
                          <div className="row" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
                            <div className="event-date">
                              <strong>{Number(day)}</strong>
                              <span>{MONTHS[Number(m) - 1]}</span>
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div className="cell-main">
                                {b.customer_name} · {titleCase(b.event_type)}
                              </div>
                              <div className="cell-sub">
                                {weekday(b.event_date)} · {b.slot_label} · {b.space.name} · {b.guests} guests · {b.code}
                              </div>
                            </div>
                          </div>
                          <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                            <strong>{money(b.total)}</strong>
                            <StatusPill status={b.status} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
              <div className="stack">
                <Card title="Next 7 days" subtitle="Confirmed events per day">
                  <BarChart
                    height={150}
                    data={d.week.map((w, i) => ({ label: i === 0 ? 'Today' : weekday(w.date), value: w.bookings, title: `${w.date}: ${w.bookings} event(s)`, highlight: i === 0 }))}
                    ariaLabel="Events in the next 7 days"
                  />
                </Card>
                <Card title="Rating">
                  {d.rating?.c ? (
                    <div className="row">
                      <span className="rating-big">{d.rating.a?.toFixed(1)}</span>
                      <div>
                        <div className="stars" aria-hidden="true">
                          {'★'.repeat(Math.round(d.rating.a || 0))}
                          {'☆'.repeat(5 - Math.round(d.rating.a || 0))}
                        </div>
                        <div className="muted small">
                          {d.rating.c} review{d.rating.c === 1 ? '' : 's'} · <Link to="/business/reviews">Read & reply</Link>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="muted">No reviews yet. Customers can review after their event is completed.</p>
                  )}
                </Card>
                <Card title="Quick actions">
                  <div className="quick-actions">
                    <Button variant="accent" icon={Icons.plus} block onClick={() => setOffline(true)}>
                      Add offline booking
                    </Button>
                    <Button variant="secondary" icon={Icons.lock} block onClick={() => setBlock(true)}>
                      Block date
                    </Button>
                    <Link className="btn btn-ghost btn-md btn-block" to="/business/calendar">
                      {Icons.calendar} Open calendar
                    </Link>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}
      </Async>
      <OfflineBookingModal open={offline} onClose={() => setOffline(false)} onDone={() => state.reload()} />
      <HoldModal kind="BLOCK" open={block} onClose={() => setBlock(false)} onDone={() => state.reload()} />
    </>
  );
}
