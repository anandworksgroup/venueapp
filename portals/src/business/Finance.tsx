import { useState } from 'react';
import { bizApi } from '../api';
import { dateTime, money, titleCase } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { StatusPill } from '../shared/StatusPill';
import { Async, Card, DateText, EmptyState, Money, PageHeader, Stat, Table, Tabs } from '../ui';

interface FinanceResp {
  summary: { gross_booking_value: number; collected: number; refunds: number; commission: number; net_payable: number; held_until_event: number; pending_payout: number; paid_out: number };
  payouts: { id: string; amount: number; status: string; reference: string | null; created_at: string; paid_at: string | null }[];
  ledger: { txn_id: string; account: string; debit: number; credit: number; booking_id: string | null; ref_type: string; ref_id: string; memo: string | null; at: string }[];
  bookings: { code: string; event_date: string; total: number; paid_amount: number; refunded_amount: number; commission_amount: number; business_payable: number; payout_status: string; status: string }[];
}

export function FinancePage() {
  const state = useAsync(() => bizApi.get<FinanceResp>('/business/finance'), []);
  const [tab, setTab] = useState<'settlements' | 'payouts' | 'ledger'>('settlements');
  return (
    <>
      <PageHeader title="Finance" subtitle="What customers paid, what Pandal keeps, and what reaches your bank." />
      <Async state={state}>
        {(d) => (
          <div className="stack">
            <div className="grid-4">
              <Stat label="Total bookings" value={money(d.summary.gross_booking_value)} hint={`${money(d.summary.collected)} collected online`} tone="teal" />
              <Stat label="Platform commission" value={money(d.summary.commission)} hint="Pandal fee on paid bookings" />
              <Stat label="Refunds" value={money(d.summary.refunds)} hint="Returned to customers" tone={d.summary.refunds ? 'danger' : undefined} />
              <Stat label="Net payable" value={money(d.summary.net_payable)} hint="Collected − refunds − commission" tone="accent" />
              <Stat label="Held until event" value={money(d.summary.held_until_event)} hint="Released after the event is completed" />
              <Stat label="Pending payout" value={money(d.summary.pending_payout)} hint="Eligible or in the next payout batch" tone="warning" />
              <Stat label="Paid out" value={money(d.summary.paid_out)} hint="Sent to your bank" tone="success" />
            </div>
            <Card pad={false}>
              <div style={{ padding: '6px 12px 0' }}>
                <Tabs
                  value={tab}
                  onChange={setTab}
                  items={[
                    { key: 'settlements', label: 'Per-booking settlement', count: d.bookings.length },
                    { key: 'payouts', label: 'Payouts', count: d.payouts.length },
                    { key: 'ledger', label: 'Ledger', count: d.ledger.length },
                  ]}
                />
              </div>
              {tab === 'settlements' && (
                <Table
                  rows={d.bookings}
                  rowKey={(b) => b.code}
                  empty={<EmptyState title="No paid online bookings yet" />}
                  columns={[
                    { key: 'c', header: 'Booking', render: (b) => <span className="mono">{b.code}</span> },
                    { key: 'd', header: 'Event date', render: (b) => <DateText value={b.event_date} /> },
                    { key: 't', header: 'Total', align: 'right', render: (b) => <Money value={b.total} /> },
                    { key: 'p', header: 'Paid', align: 'right', render: (b) => <Money value={b.paid_amount} /> },
                    { key: 'r', header: 'Refunded', align: 'right', render: (b) => (b.refunded_amount ? <Money value={b.refunded_amount} /> : '—') },
                    { key: 'm', header: 'Commission', align: 'right', render: (b) => <Money value={b.commission_amount} /> },
                    { key: 'y', header: 'Your payable', align: 'right', render: (b) => <Money value={b.business_payable} strong /> },
                    { key: 's', header: 'Payout', render: (b) => <StatusPill status={b.payout_status} /> },
                  ]}
                />
              )}
              {tab === 'payouts' && (
                <Table
                  rows={d.payouts}
                  rowKey={(p) => p.id}
                  empty={<EmptyState title="No payouts yet" body="Payouts are batched after your events are completed." />}
                  columns={[
                    { key: 'id', header: 'Payout', render: (p) => <span className="mono">{p.id}</span> },
                    { key: 'c', header: 'Created', render: (p) => dateTime(p.created_at) },
                    { key: 'a', header: 'Amount', align: 'right', render: (p) => <Money value={p.amount} strong /> },
                    { key: 's', header: 'Status', render: (p) => <StatusPill status={p.status} /> },
                    { key: 'r', header: 'Bank reference (UTR)', render: (p) => p.reference || '—' },
                    { key: 'p', header: 'Paid on', render: (p) => (p.paid_at ? dateTime(p.paid_at) : '—') },
                  ]}
                />
              )}
              {tab === 'ledger' && (
                <Table
                  dense
                  rows={d.ledger}
                  rowKey={(l) => `${l.txn_id}-${l.account}-${l.debit}-${l.credit}`}
                  empty={<EmptyState title="No ledger entries yet" />}
                  columns={[
                    { key: 'at', header: 'When', render: (l) => dateTime(l.at) },
                    { key: 'a', header: 'Account', render: (l) => titleCase(l.account) },
                    { key: 'm', header: 'Memo', render: (l) => l.memo || titleCase(l.ref_type) },
                    { key: 'd', header: 'Debit', align: 'right', render: (l) => (l.debit ? money(l.debit) : '') },
                    { key: 'c', header: 'Credit', align: 'right', render: (l) => (l.credit ? money(l.credit) : '') },
                  ]}
                />
              )}
            </Card>
          </div>
        )}
      </Async>
    </>
  );
}
