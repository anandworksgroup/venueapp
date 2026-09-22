import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { bizApi } from '../api';
import { date as fmtDate, monthLabel, shiftMonth, titleCase, todayIst, weekday } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { Icons } from '../shared/icons';
import { StatusPill } from '../shared/StatusPill';
import { Async, Button, Card, ConfirmDialog, Drawer, EmptyState, IconButton, PageHeader, Select } from '../ui';
import type { CalendarCell, CalendarDay, CalendarResp, Slot } from '../types';
import { useBiz } from './context';
import { HoldModal, OfflineBookingModal, type InventoryDefaults } from './InventoryModals';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KIND_LABEL: Record<CalendarCell['kind'], string> = {
  BOOKING: 'Online booking',
  OFFLINE: 'Offline booking',
  RESERVATION: 'On hold (checkout in progress)',
  BLOCK: 'Blocked',
  MAINTENANCE: 'Maintenance',
};

export function CalendarPage() {
  const { me } = useBiz();
  const venues = me.venues || [];
  const [venueId, setVenueId] = useState(venues[0]?.id || '');
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [offline, setOffline] = useState<InventoryDefaults | null>(null);
  const [hold, setHold] = useState<{ kind: 'BLOCK' | 'MAINTENANCE'; defaults: InventoryDefaults } | null>(null);
  const [removing, setRemoving] = useState<CalendarCell | null>(null);
  const state = useAsync(() => bizApi.get<CalendarResp>('/business/calendar', { venue_id: venueId || undefined, month }), [venueId, month]);
  const today = todayIst();

  const day = useMemo(() => state.data?.days.find((d) => d.date === selected) || null, [state.data, selected]);
  const spaceName = (id: string) => state.data?.spaces.find((s) => s.id === id)?.name || 'Space';

  const removeHold = async (c: CalendarCell) => {
    await bizApi.del(`/business/holds/${c.group_id}`);
    state.reload();
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Every space, every slot: online, offline, blocks and maintenance in one view."
        actions={
          <>
            <Button variant="secondary" icon={Icons.wrench} onClick={() => setHold({ kind: 'MAINTENANCE', defaults: { venueId } })}>
              Maintenance
            </Button>
            <Button variant="secondary" icon={Icons.lock} onClick={() => setHold({ kind: 'BLOCK', defaults: { venueId } })}>
              Block date
            </Button>
            <Button variant="accent" icon={Icons.plus} onClick={() => setOffline({ venueId })}>
              Create booking
            </Button>
          </>
        }
      />
      <Card>
        <div className="cal-toolbar">
          <div className="cal-month">
            <IconButton label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
              {Icons.chevronLeft}
            </IconButton>
            <h2>{monthLabel(month)}</h2>
            <IconButton label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
              {Icons.chevronRight}
            </IconButton>
            {month !== today.slice(0, 7) && (
              <Button size="sm" variant="ghost" onClick={() => setMonth(today.slice(0, 7))}>
                Today
              </Button>
            )}
          </div>
          {venues.length > 1 && (
            <div style={{ minWidth: 220 }}>
              <Select aria-label="Venue" value={venueId} onChange={(e) => setVenueId(e.target.value)} options={venues.map((v) => ({ value: v.id, label: v.name }))} />
            </div>
          )}
          <div className="cal-legend">
            <span><i className="lg lg-available" /> Available</span>
            <span><i className="lg lg-partial" /> Partly booked</span>
            <span><i className="lg lg-booked" /> Fully booked</span>
            <span><i className="lg lg-block" /> Blocked</span>
            <span><i className="lg lg-past" /> Past</span>
          </div>
        </div>
        <Async state={state} loadingLabel="Loading calendar…">
          {(cal) =>
            !cal.spaces.length ? (
              <EmptyState title="No active spaces yet" body="Add spaces to your venue to start managing availability." action={<Link className="btn btn-primary btn-md" to="/business/venue">Add spaces</Link>} />
            ) : (
              <MonthGrid days={cal.days} spaces={cal.spaces} today={today} selected={selected} onSelect={setSelected} loading={state.loading} />
            )
          }
        </Async>
      </Card>

      <Drawer
        open={!!day}
        onClose={() => setSelected(null)}
        title={day ? `${weekday(day.date)}, ${fmtDate(day.date)}` : ''}
        width={520}
        footer={
          day && !day.past ? (
            <div className="day-actions" style={{ width: '100%' }}>
              <Button variant="accent" icon={Icons.plus} onClick={() => setOffline({ venueId, date: day.date })}>
                Mark booked / Create booking
              </Button>
              <div className="grid-2" style={{ gap: 8 }}>
                <Button variant="secondary" icon={Icons.lock} onClick={() => setHold({ kind: 'BLOCK', defaults: { venueId, date: day.date } })}>
                  Block date
                </Button>
                <Button variant="secondary" icon={Icons.wrench} onClick={() => setHold({ kind: 'MAINTENANCE', defaults: { venueId, date: day.date } })}>
                  Maintenance block
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        {day && (
          <>
            <div className="row">
              <StatusPill status={day.past ? 'EXPIRED' : day.status === 'available' ? 'ACTIVE' : day.status === 'partial' ? 'PENDING' : 'CANCELLED'} label={day.past ? 'Past date' : day.status === 'available' ? 'All slots free' : day.status === 'partial' ? 'Partly booked' : 'Fully booked'} />
            </div>
            {day.spaces.map((s) => (
              <div key={s.space_id} className="day-space">
                <strong>{spaceName(s.space_id)}</strong>
                <div className="slot-cells">
                  {(['AM', 'PM'] as const).map((u) => (
                    <SlotCell
                      key={u}
                      unit={u}
                      cell={s[u]}
                      past={day.past}
                      onBook={() => setOffline({ venueId, date: day.date, spaceId: s.space_id, slot: u === 'AM' ? 'MORNING' : 'EVENING' })}
                      onBlock={() => setHold({ kind: 'BLOCK', defaults: { venueId, date: day.date, spaceId: s.space_id, slot: (u === 'AM' ? 'MORNING' : 'EVENING') as Slot } })}
                      onRemove={(c) => setRemoving(c)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </Drawer>

      <OfflineBookingModal open={!!offline} defaults={offline || undefined} onClose={() => setOffline(null)} onDone={() => state.reload()} />
      <HoldModal kind={hold?.kind || 'BLOCK'} open={!!hold} defaults={hold?.defaults} onClose={() => setHold(null)} onDone={() => state.reload()} />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove this ${removing?.kind === 'MAINTENANCE' ? 'maintenance block' : 'block'}?`}
        message="The slot becomes available for customers to book again. A full-day block is removed for both slots."
        confirmLabel="Remove"
        danger
        onConfirm={() => removing && removeHold(removing)}
      />
    </>
  );
}

function MonthGrid({ days, spaces, today, selected, onSelect, loading }: { days: CalendarDay[]; spaces: CalendarResp['spaces']; today: string; selected: string | null; onSelect: (d: string) => void; loading: boolean }) {
  if (!days.length) return null;
  const [y, m] = days[0].date.split('-').map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const name = (id: string) => spaces.find((s) => s.id === id)?.name || '';
  const shown = 3;
  return (
    <div className="cal-grid" style={{ opacity: loading ? 0.6 : 1 }} role="grid" aria-label="Month calendar">
      {DOW.map((d) => (
        <div key={d} className="cal-dow">
          {d}
        </div>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <div key={`e${i}`} className="cal-empty" />
      ))}
      {days.map((d) => {
        return (
          <button
            key={d.date}
            type="button"
            className={`cal-day st-${d.status} ${d.past ? 'is-past' : ''} ${d.date === today ? 'is-today' : ''} ${selected === d.date ? 'is-selected' : ''}`}
            onClick={() => onSelect(d.date)}
            aria-label={`${fmtDate(d.date)}: ${d.past ? 'past' : d.status}`}
          >
            <div className="cal-top">
              <span className="cal-num">{Number(d.date.slice(8))}</span>
              <span className="cal-status">{d.past ? '' : d.status === 'available' ? 'Free' : d.status === 'partial' ? 'Partial' : 'Full'}</span>
            </div>
            <div className="cal-spaces">
              {d.spaces.slice(0, shown).map((s) => (
                <div key={s.space_id} className="cal-space" title={`${name(s.space_id)} · AM: ${s.AM ? KIND_LABEL[s.AM.kind] : 'free'} · PM: ${s.PM ? KIND_LABEL[s.PM.kind] : 'free'}`}>
                  <span className="cal-space-name">{name(s.space_id)}</span>
                  <span className={`slot-dot ${s.AM ? `k-${s.AM.kind}` : ''}`} />
                  <span className={`slot-dot ${s.PM ? `k-${s.PM.kind}` : ''}`} />
                </div>
              ))}
              {d.spaces.length > shown && <span className="cal-more">+{d.spaces.length - shown} more</span>}
            </div>
            <div className="cal-mobile-dots" aria-hidden="true">
              {d.spaces.slice(0, 4).flatMap((s) => [s.AM, s.PM]).filter(Boolean).slice(0, 6).map((c, i) => (
                <span key={i} className={`slot-dot k-${c!.kind}`} style={{ width: 6, height: 6, borderRadius: 3 }} />
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SlotCell({ unit, cell, past, onBook, onBlock, onRemove }: { unit: 'AM' | 'PM'; cell: CalendarCell | null; past: boolean; onBook: () => void; onBlock: () => void; onRemove: (c: CalendarCell) => void }) {
  const label = unit === 'AM' ? 'Morning · 8 AM–2 PM' : 'Evening · 5–11 PM';
  if (!cell) {
    return (
      <div className="slot-cell free">
        <span className="slot-name">{label}</span>
        <strong>{past ? 'Was free' : 'Available'}</strong>
        {!past && (
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant="secondary" onClick={onBook}>
              Book
            </Button>
            <Button size="sm" variant="ghost" onClick={onBlock}>
              Block
            </Button>
          </div>
        )}
      </div>
    );
  }
  const isBooking = cell.kind === 'BOOKING' || cell.kind === 'OFFLINE' || cell.kind === 'RESERVATION';
  return (
    <div className={`slot-cell k-${cell.kind}`}>
      <span className="slot-name">{label}</span>
      <strong>{KIND_LABEL[cell.kind]}</strong>
      {isBooking ? (
        <>
          <span>
            {cell.customer_name || 'Customer'}
            {cell.event_type ? ` · ${titleCase(cell.event_type)}` : ''}
            {cell.guests ? ` · ${cell.guests} guests` : ''}
          </span>
          <span className="row" style={{ gap: 6 }}>
            {cell.code && <span className="mono">{cell.code}</span>}
            {cell.status && <StatusPill status={cell.status} />}
          </span>
          {cell.booking_id && (
            <Link to={`/business/bookings/${cell.booking_id}`} className="small">
              View booking →
            </Link>
          )}
        </>
      ) : (
        <>
          {cell.note && <span>{cell.note}</span>}
          {!past && (
            <div>
              <Button size="sm" variant="ghost" icon={Icons.trash} onClick={() => onRemove(cell)}>
                Remove
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
