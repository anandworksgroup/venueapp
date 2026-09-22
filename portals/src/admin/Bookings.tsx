import { useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { adminApi } from '../api';
import { Timeline } from '../shared/Brand';
import { date as fmtDate, dateTime, money, titleCase, todayIst } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { StatusPill } from '../shared/StatusPill';
import { Async, Button, Card, ConfirmDialog, DateText, Drawer, EmptyState, Field, KeyValue, Money, NumberInput, PageHeader, Select, Table, useToast } from '../ui';
import type { Booking, BookingFull } from '../types';
import { useAdmin } from './context';
import { SearchBox, useDebounced } from './Customers';

const STATUSES = ['REQUESTED', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_FAILED', 'CONFIRMED', 'UPCOMING', 'COMPLETED', 'CANCELLATION_REQUESTED', 'CANCELLED', 'REFUND_PROCESSING', 'REFUNDED', 'EXPIRED', 'REJECTED'];

type AdminBooking = BookingFull & {
  messages: { id: string; sender_role: string; body: string; at: string }[];
  disputes: { id: string; subject: string; body: string; status: string; resolution: string | null; created_at: string }[];
  ledger: { id: string; txn_id: string; account: string; debit: number; credit: number; memo: string | null; at: string }[];
};

export function AdminBookingsPage() {
  const [params, setParams] = useSearchParams();
  const { id } = useParams();
  const navigate = useNavigate();
  const status = params.get('status') || '';
  const source = params.get('source') || '';
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const state = useAsync(() => adminApi.get<{ items: Booking[]; total: number }>('/admin/bookings', { status, source, q: search, limit: 200 }), [status, source, search]);
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p);
  };
  return (
    <>
      <PageHeader title="Bookings" subtitle={state.data ? `${state.data.total} matching` : undefined} />
      <div className="row" style={{ marginBottom: 14 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search code, customer or phone" />
        <div style={{ minWidth: 200 }}>
          <Select aria-label="Status" value={status} onChange={(e) => set('status', e.target.value)} placeholder="All statuses" options={STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} />
        </div>
        <div style={{ minWidth: 160 }}>
          <Select aria-label="Source" value={source} onChange={(e) => set('source', e.target.value)} placeholder="All sources" options={[{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }]} />
        </div>
      </div>
      <Card pad={false}>
        <Async state={state}>
          {(d) => (
            <Table
              rows={d.items}
              rowKey={(b) => b.id}
              onRowClick={(b) => navigate(`/admin/bookings/${b.id}?${params.toString()}`)}
              empty={<EmptyState title="No bookings match" />}
              columns={[
                { key: 'c', header: 'Booking', render: (b) => (<><div className="cell-main mono">{b.code}</div><div className="cell-sub">{b.customer_name}</div></>) },
                { key: 'v', header: 'Venue', render: (b) => (<><div>{b.venue?.name}</div><div className="cell-sub">{b.space.name}</div></>) },
                { key: 'd', header: 'Event', render: (b) => (<><DateText value={b.event_date} /><div className="cell-sub">{b.slot_label} · {titleCase(b.event_type)}</div></>) },
                { key: 'src', header: 'Source', render: (b) => titleCase(b.source), hideSm: true },
                { key: 't', header: 'Total', align: 'right', render: (b) => <Money value={b.total} strong /> },
                { key: 'p', header: 'Paid', align: 'right', render: (b) => <Money value={b.paid_amount} />, hideSm: true },
                { key: 's', header: 'Status', render: (b) => <StatusPill status={b.status} /> },
              ]}
            />
          )}
        </Async>
      </Card>
      <Drawer open={!!id} onClose={() => navigate(`/admin/bookings?${params.toString()}`)} title="Booking" width={680}>
        {id && <AdminBookingDetail id={id} onChanged={state.reload} />}
      </Drawer>
    </>
  );
}

function AdminBookingDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const state = useAsync(() => adminApi.get<AdminBooking>(`/admin/bookings/${id}`), [id]);
  const { can } = useAdmin();
  const toast = useToast();
  const [cancel, setCancel] = useState(false);
  const [complete, setComplete] = useState(false);
  const [override, setOverride] = useState<number | ''>('');
  return (
    <Async state={state}>
      {(b) => {
        const cancellable = ['CONFIRMED', 'UPCOMING'].includes(b.status) && b.event_date >= todayIst();
        const completable = ['CONFIRMED', 'UPCOMING'].includes(b.status) && b.event_date <= todayIst();
        const kv: [ReactNode, ReactNode][] = [
          ['Customer', `${b.customer_name || '—'} · ${b.customer_phone || ''}`],
          ['Venue', `${b.venue?.name} · ${b.space.name}`],
          ['Event', `${titleCase(b.event_type)} · ${b.guests} guests`],
          ['Date', `${fmtDate(b.event_date)} · ${b.slot_label} (${b.slot_time})`],
          ['Source', b.source === 'offline' ? `Offline · ${titleCase(b.source_channel)}` : 'Online'],
          ['Package', b.package?.name || '—'],
          ['Created', dateTime(b.created_at)],
          ['Notes', b.notes || '—'],
        ];
        if (b.cancel_reason) kv.push(['Cancel reason', b.cancel_reason]);
        return (
          <>
            <div className="row-between">
              <div>
                <div className="mono muted">{b.code}</div>
                <h2>{b.customer_name}</h2>
              </div>
              <StatusPill status={b.status} />
            </div>
            {(cancellable && can('refunds.manage')) || (completable && can('disputes.manage')) ? (
              <div className="row">
                {cancellable && can('refunds.manage') && (
                  <Button variant="danger" onClick={() => setCancel(true)}>
                    Cancel booking
                  </Button>
                )}
                {completable && can('disputes.manage') && (
                  <Button variant="secondary" onClick={() => setComplete(true)}>
                    Mark completed
                  </Button>
                )}
              </div>
            ) : null}
            <Card title="Booking">
              <KeyValue items={kv} />
            </Card>
            <Card title="Money">
              {b.items.length > 0 && (
                <Table
                  dense
                  rows={b.items}
                  rowKey={(i) => `${i.kind}-${i.label}-${i.amount}`}
                  columns={[
                    { key: 'l', header: 'Item', render: (i) => (<><div>{i.label}</div>{i.detail && <div className="cell-sub">{i.detail}</div>}</>) },
                    { key: 'q', header: 'Qty', align: 'right', render: (i) => i.qty },
                    { key: 'a', header: 'Amount', align: 'right', render: (i) => money(i.amount) },
                  ]}
                />
              )}
              <KeyValue
                items={[
                  ['Subtotal', money(b.subtotal)],
                  ['Discount', b.discount ? money(-b.discount) : '—'],
                  ['GST', money(b.tax)],
                  ['Total', <strong>{money(b.total)}</strong>],
                  ['Paid', money(b.paid_amount)],
                  ['Refunded', money(b.refunded_amount)],
                  ['Commission', money(b.commission_amount)],
                  ['Business payable', money(b.business_payable)],
                  ['Payout', <StatusPill status={b.payout_status} />],
                ]}
              />
            </Card>
            <Card title="Payments">
              <Table
                dense
                rows={b.payments}
                rowKey={(p) => p.id}
                empty={<p className="muted">No payments.</p>}
                columns={[
                  { key: 'o', header: 'Order', render: (p) => <span className="mono">{p.gateway_order_id}</span> },
                  { key: 'p', header: 'Purpose', render: (p) => titleCase(p.purpose) },
                  { key: 'a', header: 'Amount', align: 'right', render: (p) => money(p.amount) },
                  { key: 's', header: 'Status', render: (p) => <StatusPill status={p.status} /> },
                ]}
              />
            </Card>
            {b.refunds.length > 0 && (
              <Card title="Refunds">
                <Table
                  dense
                  rows={b.refunds}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: 'r', header: 'Rule', render: (r) => r.policy_rule || '—' },
                    { key: 'a', header: 'Amount', align: 'right', render: (r) => money(r.amount) },
                    { key: 's', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
                    { key: 'd', header: 'When', render: (r) => dateTime(r.processed_at || r.created_at) },
                  ]}
                />
              </Card>
            )}
            <Card title="Ledger">
              <Table
                dense
                rows={b.ledger}
                rowKey={(l) => l.id}
                empty={<p className="muted">No ledger entries.</p>}
                columns={[
                  { key: 'a', header: 'Account', render: (l) => titleCase(l.account) },
                  { key: 'd', header: 'Debit', align: 'right', render: (l) => (l.debit ? money(l.debit) : '') },
                  { key: 'c', header: 'Credit', align: 'right', render: (l) => (l.credit ? money(l.credit) : '') },
                  { key: 'm', header: 'Memo', render: (l) => l.memo },
                ]}
              />
            </Card>
            {b.disputes.length > 0 && (
              <Card title="Disputes">
                {b.disputes.map((d) => (
                  <div key={d.id} className="editor-row">
                    <div className="row-between">
                      <strong>{d.subject}</strong>
                      <StatusPill status={d.status} />
                    </div>
                    <p>{d.body}</p>
                    {d.resolution && <p className="muted">Resolution: {d.resolution}</p>}
                  </div>
                ))}
              </Card>
            )}
            <Card title="Messages">
              {b.messages.length === 0 ? (
                <p className="muted">No messages.</p>
              ) : (
                <div className="thread">
                  {b.messages.map((m) => (
                    <div key={m.id} className={`msg ${m.sender_role === 'business' ? 'me' : ''}`}>
                      {m.body}
                      <div className="msg-meta">
                        {titleCase(m.sender_role)} · {dateTime(m.at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="History">
              <Timeline items={b.history.map((h) => ({ title: `${h.from_status ? `${titleCase(h.from_status)} → ` : ''}${titleCase(h.to_status)}`, meta: `${dateTime(h.at)}${h.actor_role ? ` · ${h.actor_role}` : ''}`, body: h.note, tone: ['CANCELLED', 'REJECTED', 'PAYMENT_FAILED', 'EXPIRED'].includes(h.to_status) ? 'danger' : 'done' }))} />
            </Card>
            <ConfirmDialog
              open={cancel}
              onClose={() => setCancel(false)}
              title={`Cancel ${b.code}?`}
              message={
                b.cancellation ? (
                  <p>
                    Policy refund: <strong>{money(b.cancellation.refund_amount)}</strong> ({b.cancellation.rule?.label || 'policy'}), retained {money(b.cancellation.retained_amount)}. Leave the override empty to follow the policy.
                  </p>
                ) : undefined
              }
              extra={
                <Field label="Refund override (optional)" hint={`Max ${money(b.paid_amount - b.refunded_amount)}`}>
                  <NumberInput prefix="₹" min={0} max={b.paid_amount - b.refunded_amount} value={override} onChange={setOverride} />
                </Field>
              }
              confirmLabel="Cancel booking"
              danger
              reasonLabel="Reason"
              onConfirm={async (reason) => {
                const r = await adminApi.post<AdminBooking>(`/admin/bookings/${b.id}/cancel`, { reason, refund_amount: override === '' ? undefined : override });
                const queued = r.refunds.filter((x) => x.status === 'PENDING').reduce((a, x) => a + x.amount, 0);
                toast(queued ? `Booking cancelled. Refund of ${money(queued)} queued (see Refunds).` : `Booking cancelled. Refunded ${money(r.refunded_amount)}.`);
                setOverride('');
                state.reload();
                onChanged();
              }}
            />
            <ConfirmDialog
              open={complete}
              onClose={() => setComplete(false)}
              title={`Mark ${b.code} completed?`}
              message="Commission and business payable will be recognised."
              confirmLabel="Mark completed"
              onConfirm={async () => {
                await adminApi.post(`/admin/bookings/${b.id}/complete`);
                toast('Booking completed');
                state.reload();
                onChanged();
              }}
            />
          </>
        );
      }}
    </Async>
  );
}
