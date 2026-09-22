import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { bizApi, errMsg } from '../api';
import { Timeline } from '../shared/Brand';
import { dateTime, money, titleCase, todayIst } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { Icons } from '../shared/icons';
import { StatusPill } from '../shared/StatusPill';
import { Async, Button, Card, ConfirmDialog, DateText, Drawer, EmptyState, ErrorState, InlineError, Input, KeyValue, Loading, Money, PageHeader, Pill, Table, Tabs, useToast } from '../ui';
import type { Booking, BookingFull, Message } from '../types';

type Tab = 'new' | 'pending' | 'confirmed' | 'upcoming' | 'completed' | 'cancelled' | 'offline';
const TABS: { key: Tab; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'offline', label: 'Offline' },
];

export function paymentLabel(b: Booking) {
  if (b.source === 'offline') return <Pill>Offline</Pill>;
  if (b.refunded_amount > 0) return <Pill tone="info">Refunded {money(b.refunded_amount)}</Pill>;
  if (b.paid_amount >= b.total && b.total > 0) return <Pill tone="success">Paid in full</Pill>;
  if (b.paid_amount > 0) return <Pill tone="accent">Advance {money(b.paid_amount)}</Pill>;
  return <Pill tone="warning">Unpaid</Pill>;
}

export function BookingsPage() {
  const [params, setParams] = useSearchParams();
  const { id } = useParams();
  const navigate = useNavigate();
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'upcoming') as Tab;
  const [q, setQ] = useState(params.get('q') || '');
  const [search, setSearch] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const state = useAsync(() => bizApi.get<{ items: Booking[]; counts: Record<Tab, number> }>('/business/bookings', { tab, q: search }), [tab, search]);
  const setTab = (t: Tab) => setParams({ tab: t });
  const open = (b: Booking) => navigate(`/business/bookings/${b.id}?tab=${tab}`);
  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle="Online and offline bookings across your venues."
        actions={
          <div className="search-input">
            {Icons.search}
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or customer" aria-label="Search bookings" />
          </div>
        }
      />
      <Card pad={false}>
        <div style={{ padding: '6px 12px 0' }}>
          <Tabs items={TABS.map((t) => ({ ...t, count: state.data?.counts?.[t.key] }))} value={tab} onChange={setTab} />
        </div>
        <Async state={state}>
          {(d) => (
            <Table
              rows={d.items}
              rowKey={(b) => b.id}
              onRowClick={open}
              empty={<EmptyState title={search ? 'No bookings match your search' : `No ${TABS.find((t) => t.key === tab)?.label.toLowerCase()} bookings`} body={tab === 'pending' ? 'Booking requests and unpaid checkouts show up here.' : undefined} />}
              columns={[
                { key: 'c', header: 'Customer', render: (b) => (<><div className="cell-main">{b.customer_name || '—'}</div><div className="cell-sub mono">{b.code}</div></>) },
                { key: 'e', header: 'Event', render: (b) => (<><div>{titleCase(b.event_type)}</div><div className="cell-sub">{b.space.name} · {b.guests} guests</div></>) },
                { key: 'd', header: 'Date', render: (b) => <DateText value={b.event_date} /> },
                { key: 's', header: 'Slot', render: (b) => b.slot_label, hideSm: true },
                { key: 'a', header: 'Amount', align: 'right', render: (b) => <Money value={b.total} strong /> },
                { key: 'p', header: 'Payment', render: paymentLabel },
                { key: 'st', header: 'Status', render: (b) => <StatusPill status={b.status} label={b.status_label} /> },
              ]}
            />
          )}
        </Async>
      </Card>
      <Drawer open={!!id} onClose={() => navigate(`/business/bookings?tab=${tab}`)} title="Booking details" width={640}>
        {id && <BookingDetail id={id} onChanged={state.reload} />}
      </Drawer>
    </>
  );
}

function BookingDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const state = useAsync(() => bizApi.get<BookingFull>(`/business/bookings/${id}`), [id]);
  const [dialog, setDialog] = useState<'accept' | 'reject' | 'complete' | 'cancel' | null>(null);
  const toast = useToast();
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState error={state.error} onRetry={state.reload} />;
  const b = state.data!;
  const act = async (path: string, body?: unknown, msg?: string) => {
    const r = await bizApi.post<BookingFull>(`/business/bookings/${b.id}/${path}`, body);
    state.setData(r);
    onChanged();
    if (msg) toast(msg);
  };
  const today = todayIst();
  const canAccept = b.status === 'REQUESTED';
  const canComplete = ['CONFIRMED', 'UPCOMING'].includes(b.status) && b.event_date <= today;
  const canCancel = ['CONFIRMED', 'UPCOMING'].includes(b.status) && b.event_date >= today;
  return (
    <>
      <div className="row-between">
        <div>
          <div className="mono muted">{b.code}</div>
          <h2>
            {b.customer_name} · {titleCase(b.event_type)}
          </h2>
        </div>
        <StatusPill status={b.status} label={b.status_label} />
      </div>
      {(canAccept || canComplete || canCancel) && (
        <div className="row">
          {canAccept && (
            <>
              <Button variant="success" icon={Icons.check} onClick={() => setDialog('accept')}>
                Accept request
              </Button>
              <Button variant="danger" onClick={() => setDialog('reject')}>
                Decline
              </Button>
            </>
          )}
          {canComplete && (
            <Button variant="primary" onClick={() => setDialog('complete')}>
              Mark completed
            </Button>
          )}
          {canCancel && (
            <Button variant="ghost" onClick={() => setDialog('cancel')} style={{ color: 'var(--danger)' }}>
              Cancel booking
            </Button>
          )}
        </div>
      )}
      {b.hold_expires_at && b.status === 'REQUESTED' && <p className="muted small">Respond before {dateTime(b.hold_expires_at)}, or the request expires and the slot is released.</p>}
      <Card title="Event">
        <KeyValue
          items={[
            ['Date', <DateText value={b.event_date} />],
            ['Slot', `${b.slot_label} (${b.slot_time})`],
            ['Venue / space', `${b.venue?.name || ''} · ${b.space.name}`],
            ['Guests', b.guests],
            ['Package', b.package?.name || '—'],
            ['Source', b.source === 'offline' ? `Offline · ${titleCase(b.source_channel)}` : 'Pandal (online)'],
            ['Customer phone', b.customer_phone || '—'],
            ['Notes', b.notes || '—'],
            ...(b.cancel_reason ? [['Cancellation reason', b.cancel_reason] as [ReactNode, ReactNode]] : []),
          ]}
        />
      </Card>
      <Card title="Price">
        {b.items.length > 0 ? (
          <Table
            dense
            rows={b.items}
            rowKey={(i) => `${i.kind}-${i.label}-${i.amount}`}
            columns={[
              { key: 'l', header: 'Item', render: (i) => (<><div>{i.label}</div>{i.detail && <div className="cell-sub">{i.detail}</div>}</>) },
              { key: 'q', header: 'Qty', align: 'right', render: (i) => i.qty },
              { key: 'a', header: 'Amount', align: 'right', render: (i) => <Money value={i.amount} /> },
            ]}
          />
        ) : null}
        <KeyValue
          items={[
            ['Subtotal', <Money value={b.subtotal} />],
            ...(b.discount ? [['Discount', <Money value={-b.discount} />] as [ReactNode, ReactNode]] : []),
            ['GST', <Money value={b.tax} />],
            ['Total', <Money value={b.total} strong />],
            ['Paid', <Money value={b.paid_amount} />],
            ['Balance due', <Money value={b.balance_amount} />],
            ...(b.refunded_amount ? [['Refunded', <Money value={b.refunded_amount} />] as [ReactNode, ReactNode]] : []),
            ...(b.source === 'online' ? ([['Platform commission', <Money value={b.commission_amount} />], ['Your payable', <Money value={b.business_payable} />], ['Payout', <StatusPill status={b.payout_status} />]] as [ReactNode, ReactNode][]) : []),
          ]}
        />
      </Card>
      {b.payments.length > 0 && (
        <Card title="Payments">
          <Table
            dense
            rows={b.payments}
            rowKey={(p) => p.id}
            columns={[
              { key: 'p', header: 'Purpose', render: (p) => titleCase(p.purpose) },
              { key: 'm', header: 'Method', render: (p) => titleCase(p.method) || '—' },
              { key: 'd', header: 'Date', render: (p) => dateTime(p.verified_at || p.created_at) },
              { key: 'a', header: 'Amount', align: 'right', render: (p) => <Money value={p.amount} /> },
              { key: 's', header: 'Status', render: (p) => <StatusPill status={p.status} /> },
            ]}
          />
        </Card>
      )}
      {b.refunds.length > 0 && (
        <Card title="Refunds">
          <Table
            dense
            rows={b.refunds}
            rowKey={(r) => r.id}
            columns={[
              { key: 'r', header: 'Rule', render: (r) => r.policy_rule || '—' },
              { key: 'd', header: 'Date', render: (r) => dateTime(r.processed_at || r.created_at) },
              { key: 'a', header: 'Amount', align: 'right', render: (r) => <Money value={r.amount} /> },
              { key: 's', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
            ]}
          />
        </Card>
      )}
      <Card title="Status history">
        <Timeline
          items={b.history.map((h) => ({
            title: `${h.from_status ? `${titleCase(h.from_status)} → ` : ''}${titleCase(h.to_status)}`,
            meta: `${dateTime(h.at)}${h.actor_role ? ` · ${h.actor_role}` : ''}`,
            body: h.note,
            tone: ['CANCELLED', 'REJECTED', 'PAYMENT_FAILED', 'EXPIRED'].includes(h.to_status) ? 'danger' : 'done',
          }))}
        />
      </Card>
      {b.source === 'online' && <MessagesCard bookingId={b.id} />}

      <ConfirmDialog open={dialog === 'accept'} onClose={() => setDialog(null)} title="Accept this request?" message="The customer will be asked to pay the advance to confirm." confirmLabel="Accept" onConfirm={() => act('accept', {}, 'Request accepted')} />
      <ConfirmDialog open={dialog === 'reject'} onClose={() => setDialog(null)} title="Decline this request?" message="The slot is released and the customer is told." confirmLabel="Decline request" danger reasonLabel="Reason (shared with the customer)" onConfirm={(reason) => act('reject', { reason }, 'Request declined')} />
      <ConfirmDialog open={dialog === 'complete'} onClose={() => setDialog(null)} title="Mark this event completed?" message="The customer's payment becomes eligible for your next payout, and they'll be invited to review." confirmLabel="Mark completed" onConfirm={() => act('complete', {}, 'Marked completed')} />
      <ConfirmDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title="Cancel this booking?"
        message={
          <>
            {b.source === 'online' ? (
              <p>
                Because you are cancelling, the customer gets a <strong>full refund of {money(b.paid_amount - b.refunded_amount)}</strong>. Frequent cancellations affect your ranking.
              </p>
            ) : (
              <p>This offline booking is cancelled and the slot is freed.</p>
            )}
          </>
        }
        confirmLabel="Cancel booking"
        danger
        reasonLabel="Reason"
        onConfirm={(reason) => act('cancel', { reason }, 'Booking cancelled')}
      />
    </>
  );
}

function MessagesCard({ bookingId }: { bookingId: string }) {
  const state = useAsync(() => bizApi.get<{ items: Message[] }>(`/business/bookings/${bookingId}/messages`), [bookingId]);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!body.trim()) return;
    setPending(true);
    setError(null);
    try {
      await bizApi.post(`/business/bookings/${bookingId}/messages`, { body: body.trim() });
      setBody('');
      state.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Card title="Messages" subtitle="Chat with the customer through Pandal. Phone numbers are hidden automatically.">
      <Async state={state}>
        {(d) =>
          d.items.length === 0 ? (
            <p className="muted">No messages yet.</p>
          ) : (
            <div className="thread">
              {d.items.map((m) => (
                <div key={m.id} className={`msg ${m.sender_role === 'business' ? 'me' : ''}`}>
                  {m.body}
                  <div className="msg-meta">
                    {m.sender_role === 'business' ? 'You' : titleCase(m.sender_role)} · {dateTime(m.at)}
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </Async>
      <div className="composer">
        <Input value={body} maxLength={1000} placeholder="Write a message…" onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())} />
        <Button onClick={send} pending={pending} disabled={!body.trim()}>
          Send
        </Button>
      </div>
      <InlineError message={error} />
    </Card>
  );
}
