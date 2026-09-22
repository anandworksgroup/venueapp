import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, errMsg } from '../api';
import { dateTime, money, titleCase } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { Icons } from '../shared/icons';
import { StatusPill } from '../shared/StatusPill';
import { Async, Banner, Button, Card, Chips, ConfirmDialog, EmptyState, Field, InlineError, Input, Modal, PageHeader, Pill, Select, Stat, Table, useToast } from '../ui';

// ─────────────── Payments ───────────────
interface Payment {
  id: string;
  booking_id: string;
  booking_code: string;
  customer_name: string;
  purpose: string;
  amount: number;
  status: string;
  gateway: string;
  gateway_order_id: string;
  gateway_payment_id: string | null;
  method: string | null;
  failure_reason: string | null;
  created_at: string;
  verified_at: string | null;
}

export function PaymentsPage() {
  const [status, setStatus] = useState('');
  const state = useAsync(() => adminApi.get<{ items: Payment[] }>('/admin/payments', { status, limit: 200 }), [status]);
  return (
    <>
      <PageHeader title="Payments" subtitle="Every gateway order and its verified outcome." />
      <div style={{ marginBottom: 14 }}>
        <Chips value={status} onChange={setStatus} items={['', 'CAPTURED', 'CREATED', 'PROCESSING', 'FAILED', 'EXPIRED'].map((s) => ({ key: s, label: s ? titleCase(s) : 'All' }))} />
      </div>
      <Card pad={false}>
        <Async state={state}>
          {(d) => (
            <Table
              rows={d.items}
              rowKey={(p) => p.id}
              empty={<EmptyState title="No payments" />}
              columns={[
                { key: 'b', header: 'Booking', render: (p) => (<><Link to={`/admin/bookings/${p.booking_id}`} className="mono">{p.booking_code}</Link><div className="cell-sub">{p.customer_name}</div></>) },
                { key: 'o', header: 'Gateway order', render: (p) => (<><div className="mono">{p.gateway_order_id}</div><div className="cell-sub mono">{p.gateway_payment_id || '—'}</div></>), hideSm: true },
                { key: 'p', header: 'Purpose', render: (p) => titleCase(p.purpose) },
                { key: 'm', header: 'Method', render: (p) => titleCase(p.method) || '—', hideSm: true },
                { key: 'a', header: 'Amount', align: 'right', render: (p) => <strong>{money(p.amount)}</strong> },
                { key: 'd', header: 'Created', render: (p) => dateTime(p.created_at) },
                { key: 's', header: 'Status', render: (p) => (<><StatusPill status={p.status} />{p.failure_reason && <div className="cell-sub">{p.failure_reason}</div>}</>) },
              ]}
            />
          )}
        </Async>
      </Card>
    </>
  );
}

// ─────────────── Reconciliation ───────────────
interface ReconRow {
  payment_id: string;
  booking_code: string;
  amount: number;
  our_status: string;
  gateway_status: string;
  gateway_amount: number | null;
  expected_gateway_status: string | null;
  mismatch: boolean;
}

export function ReconciliationPage() {
  const state = useAsync(() => adminApi.get<{ items: ReconRow[]; mismatches: number }>('/admin/reconciliation'), []);
  return (
    <>
      <PageHeader title="Reconciliation" subtitle="Our payment records vs. the gateway, last 30 days." actions={<Button variant="secondary" onClick={state.reload}>Re-run</Button>} />
      <Async state={state}>
        {(d) => (
          <div className="stack">
            {d.mismatches ? (
              <Banner tone="danger" title={`${d.mismatches} mismatch${d.mismatches > 1 ? 'es' : ''} found`}>
                Highlighted rows disagree with the gateway on status or amount. Investigate before the next payout run.
              </Banner>
            ) : (
              <Banner tone="success" title="All payments reconciled ✓">
                {d.items.length} payment(s) checked against the gateway.
              </Banner>
            )}
            <Card pad={false}>
              <Table
                rows={d.items}
                rowKey={(r) => r.payment_id}
                rowClassName={(r) => (r.mismatch ? 'row-danger' : undefined)}
                empty={<EmptyState title="No payments in the last 30 days" />}
                columns={[
                  { key: 'b', header: 'Booking', render: (r) => <span className="mono">{r.booking_code}</span> },
                  { key: 'p', header: 'Payment', render: (r) => <span className="mono small">{r.payment_id}</span>, hideSm: true },
                  { key: 'a', header: 'Our amount', align: 'right', render: (r) => money(r.amount) },
                  { key: 'ga', header: 'Gateway amount', align: 'right', render: (r) => (r.gateway_amount == null ? '—' : money(r.gateway_amount)) },
                  { key: 'o', header: 'Our status', render: (r) => <StatusPill status={r.our_status} /> },
                  { key: 'g', header: 'Gateway', render: (r) => titleCase(r.gateway_status) },
                  { key: 'm', header: 'Result', render: (r) => (r.mismatch ? <Pill tone="danger">Mismatch</Pill> : <Pill tone="success">OK</Pill>) },
                ]}
              />
            </Card>
          </div>
        )}
      </Async>
    </>
  );
}

// ─────────────── Refunds ───────────────
interface Refund {
  id: string;
  booking_id: string;
  booking_code: string;
  customer_name: string;
  amount: number;
  status: string;
  reason: string | null;
  policy_rule: string | null;
  gateway_refund_id: string | null;
  created_at: string;
  processed_at: string | null;
}

export function RefundsPage() {
  const [status, setStatus] = useState('PENDING');
  const state = useAsync(() => adminApi.get<{ items: Refund[] }>('/admin/refunds', { status }), [status]);
  const [target, setTarget] = useState<Refund | null>(null);
  const toast = useToast();
  return (
    <>
      <PageHeader title="Refunds" subtitle="Refunds are queued on cancellation and sent to the customer's original payment method." />
      <div style={{ marginBottom: 14 }}>
        <Chips value={status} onChange={setStatus} items={['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', ''].map((s) => ({ key: s, label: s ? titleCase(s) : 'All' }))} />
      </div>
      <Card pad={false}>
        <Async state={state}>
          {(d) => (
            <Table
              rows={d.items}
              rowKey={(r) => r.id}
              empty={<EmptyState title={status === 'PENDING' ? 'No pending refunds' : 'No refunds'} body={status === 'PENDING' ? 'All caught up.' : undefined} />}
              columns={[
                { key: 'b', header: 'Booking', render: (r) => (<><Link to={`/admin/bookings/${r.booking_id}`} className="mono">{r.booking_code}</Link><div className="cell-sub">{r.customer_name}</div></>) },
                { key: 'r', header: 'Reason / rule', render: (r) => (<><div>{r.reason || '—'}</div><div className="cell-sub">{r.policy_rule}</div></>) },
                { key: 'a', header: 'Amount', align: 'right', render: (r) => <strong>{money(r.amount)}</strong> },
                { key: 'c', header: 'Created', render: (r) => dateTime(r.created_at) },
                { key: 's', header: 'Status', render: (r) => (<><StatusPill status={r.status} />{r.gateway_refund_id && <div className="cell-sub mono">{r.gateway_refund_id}</div>}</>) },
                {
                  key: 'x',
                  header: '',
                  align: 'right',
                  render: (r) =>
                    r.status === 'PENDING' || r.status === 'FAILED' ? (
                      <Button size="sm" onClick={() => setTarget(r)}>
                        Process refund
                      </Button>
                    ) : null,
                },
              ]}
            />
          )}
        </Async>
      </Card>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={`Refund ${money(target?.amount)} to ${target?.customer_name}?`}
        message={`Booking ${target?.booking_code}. The refund is sent through the payment gateway and posted to the ledger.`}
        confirmLabel="Process refund"
        onConfirm={async () => {
          await adminApi.post(`/admin/refunds/${target!.id}/process`);
          toast('Refund processed');
          state.reload();
        }}
      />
    </>
  );
}

// ─────────────── Payouts ───────────────
interface PayoutRow {
  id: string;
  business_id: string;
  business_name: string;
  amount: number;
  status: string;
  reference: string | null;
  created_at: string;
  paid_at: string | null;
  bank_ifsc: string | null;
  bank_account_last4: string | null;
}
interface Eligible {
  business_id: string;
  business_name: string;
  bookings: number;
  amount: number;
  has_bank: number;
}

export function PayoutsPage() {
  const state = useAsync(() => adminApi.get<{ items: PayoutRow[]; eligible: Eligible[] }>('/admin/payouts'), []);
  const [run, setRun] = useState<{ business_id?: string; label: string } | null>(null);
  const [paying, setPaying] = useState<PayoutRow | null>(null);
  const [utr, setUtr] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const markPaid = async () => {
    if (!utr.trim()) return setError('Enter the bank reference (UTR)');
    setPending(true);
    setError(null);
    try {
      await adminApi.post(`/admin/payouts/${paying!.id}/mark-paid`, { reference: utr.trim() });
      toast('Payout marked paid');
      setPaying(null);
      state.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <PageHeader title="Payouts" subtitle="Settle completed events to business bank accounts." actions={<Button icon={Icons.payout} onClick={() => setRun({ label: 'all eligible businesses' })} disabled={!state.data?.eligible.length}>Run payout batch</Button>} />
      <Async state={state}>
        {(d) => (
          <div className="stack">
            <Card title="Eligible balances" subtitle="Completed events not yet in a payout.">
              <Table
                rows={d.eligible}
                rowKey={(e) => e.business_id}
                empty={<EmptyState title="Nothing eligible right now" body="Balances appear here after events are completed." />}
                columns={[
                  { key: 'b', header: 'Business', render: (e) => <Link to={`/admin/businesses/${e.business_id}`}>{e.business_name}</Link> },
                  { key: 'n', header: 'Bookings', align: 'right', render: (e) => e.bookings },
                  { key: 'a', header: 'Amount', align: 'right', render: (e) => <strong>{money(e.amount)}</strong> },
                  { key: 'k', header: 'Bank', render: (e) => (e.has_bank ? <Pill tone="success">On file</Pill> : <Pill tone="danger">Missing, will be skipped</Pill>) },
                  { key: 'x', header: '', align: 'right', render: (e) => <Button size="sm" variant="secondary" disabled={!e.has_bank} onClick={() => setRun({ business_id: e.business_id, label: e.business_name })}>Pay this business</Button> },
                ]}
              />
            </Card>
            <Card title="Payouts" pad={false}>
              <Table
                rows={d.items}
                rowKey={(p) => p.id}
                empty={<EmptyState title="No payouts yet" />}
                columns={[
                  { key: 'b', header: 'Business', render: (p) => (<><div className="cell-main">{p.business_name}</div><div className="cell-sub">{p.bank_ifsc} · XXXX{p.bank_account_last4}</div></>) },
                  { key: 'id', header: 'Payout', render: (p) => <span className="mono small">{p.id}</span>, hideSm: true },
                  { key: 'c', header: 'Created', render: (p) => dateTime(p.created_at) },
                  { key: 'a', header: 'Amount', align: 'right', render: (p) => <strong>{money(p.amount)}</strong> },
                  { key: 's', header: 'Status', render: (p) => <StatusPill status={p.status} /> },
                  { key: 'r', header: 'UTR', render: (p) => (p.reference ? <span className="mono">{p.reference}</span> : '—') },
                  { key: 'x', header: '', align: 'right', render: (p) => (['PENDING', 'PROCESSING'].includes(p.status) ? <Button size="sm" variant="success" onClick={() => (setPaying(p), setUtr(''), setError(null))}>Mark paid</Button> : p.paid_at ? <span className="muted small">{dateTime(p.paid_at)}</span> : null) },
                ]}
              />
            </Card>
          </div>
        )}
      </Async>
      <ConfirmDialog
        open={!!run}
        onClose={() => setRun(null)}
        title="Create payout batch?"
        message={`Groups every eligible booking for ${run?.label} into a pending payout. You then transfer the money and mark each payout paid with its UTR.`}
        confirmLabel="Create payouts"
        onConfirm={async () => {
          const r = await adminApi.post<{ created: { amount: number }[] }>('/admin/payouts/run', run?.business_id ? { business_id: run.business_id } : {});
          toast(r.created.length ? `${r.created.length} payout(s) created · ${money(r.created.reduce((a, p) => a + p.amount, 0))}` : 'Nothing to pay out');
          state.reload();
        }}
      />
      <Modal
        open={!!paying}
        onClose={() => setPaying(null)}
        title={`Mark ${money(paying?.amount)} paid`}
        width={460}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button variant="success" onClick={markPaid} pending={pending}>
              Mark paid
            </Button>
          </>
        }
      >
        <div className="stack">
          <p>
            Payout to <strong>{paying?.business_name}</strong> ({paying?.bank_ifsc} · XXXX{paying?.bank_account_last4}). Enter the bank transfer reference after sending the money.
          </p>
          <Field label="Bank reference (UTR)" required>
            <Input value={utr} maxLength={60} onChange={(e) => setUtr(e.target.value)} autoFocus placeholder="e.g. UTIBR52026092200123" />
          </Field>
          <InlineError message={error} />
        </div>
      </Modal>
    </>
  );
}

// ─────────────── Finance & ledger ───────────────
interface Summary {
  balances: Record<string, { debit: number; credit: number; balance: number }>;
  collected: number;
  refunded: number;
  refunds_pending: number;
  platform_commission: number;
  customer_deposits_held: number;
  business_payable: number;
  paid_out: number;
  gst_collected: number;
}
interface LedgerRow {
  id: string;
  txn_id: string;
  account: string;
  debit: number;
  credit: number;
  booking_id: string | null;
  business_id: string | null;
  ref_type: string;
  ref_id: string;
  memo: string | null;
  at: string;
}
const ACCOUNTS = ['GATEWAY_CLEARING', 'CUSTOMER_DEPOSITS', 'PLATFORM_COMMISSION', 'BUSINESS_PAYABLE', 'BANK_PAYOUTS'];

export function LedgerPage() {
  const [account, setAccount] = useState('');
  const summary = useAsync(() => adminApi.get<Summary>('/admin/finance/summary'), []);
  const ledger = useAsync(() => adminApi.get<{ items: LedgerRow[]; balances: Summary['balances']; unbalanced_txns: { txn_id: string; d: number; c: number }[] }>('/admin/ledger', { account, limit: 200 }), [account]);
  return (
    <>
      <PageHeader title="Finance & ledger" subtitle="Double-entry ledger: every money movement balances." />
      <div className="stack">
        <Async state={ledger}>
          {(l) =>
            l.unbalanced_txns.length === 0 ? (
              <Banner tone="success" title="Ledger balanced ✓">
                Every transaction's debits equal its credits.
              </Banner>
            ) : (
              <Banner tone="danger" title={`${l.unbalanced_txns.length} unbalanced transaction(s)`}>
                {l.unbalanced_txns.map((t) => `${t.txn_id} (Dr ${money(t.d)} / Cr ${money(t.c)})`).join(', ')}
              </Banner>
            )
          }
        </Async>
        <Async state={summary}>
          {(s) => (
            <div className="grid-4">
              <Stat label="Collected" value={money(s.collected)} tone="teal" />
              <Stat label="Refunded" value={money(s.refunded)} tone="danger" />
              <Stat label="Pending refunds" value={money(s.refunds_pending)} tone={s.refunds_pending ? 'warning' : undefined} />
              <Stat label="Commission earned" value={money(s.platform_commission)} tone="accent" />
              <Stat label="Customer deposits held" value={money(s.customer_deposits_held)} hint="Until events complete" />
              <Stat label="Business payable" value={money(s.business_payable)} hint="Owed to businesses" tone="warning" />
              <Stat label="Paid out" value={money(s.paid_out)} tone="success" />
              <Stat label="GST collected" value={money(s.gst_collected)} />
            </div>
          )}
        </Async>
        <Card title="Account balances">
          <Async state={summary}>
            {(s) => (
              <Table
                dense
                rows={Object.entries(s.balances).map(([k, v]) => ({ account: k, ...v }))}
                rowKey={(r) => r.account}
                empty={<EmptyState title="No ledger activity yet" />}
                columns={[
                  { key: 'a', header: 'Account', render: (r) => <span className="cell-main">{titleCase(r.account)}</span> },
                  { key: 'd', header: 'Debits', align: 'right', render: (r) => money(r.debit) },
                  { key: 'c', header: 'Credits', align: 'right', render: (r) => money(r.credit) },
                  { key: 'b', header: 'Balance (Cr − Dr)', align: 'right', render: (r) => <strong>{money(r.balance)}</strong> },
                ]}
              />
            )}
          </Async>
        </Card>
        <Card
          title="Ledger entries"
          subtitle="Latest 200"
          actions={
            <div style={{ minWidth: 220 }}>
              <Select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="All accounts" options={ACCOUNTS.map((a) => ({ value: a, label: titleCase(a) }))} />
            </div>
          }
        >
          <Async state={ledger}>
            {(l) => (
              <div className="table-scroll-lg">
                <Table
                  dense
                  rows={l.items}
                  rowKey={(r) => r.id}
                  empty={<EmptyState title="No entries" />}
                  columns={[
                    { key: 't', header: 'When', render: (r) => dateTime(r.at) },
                    { key: 'x', header: 'Txn', render: (r) => <span className="mono small">{r.txn_id}</span>, hideSm: true },
                    { key: 'a', header: 'Account', render: (r) => titleCase(r.account) },
                    { key: 'm', header: 'Memo', render: (r) => r.memo || titleCase(r.ref_type) },
                    { key: 'd', header: 'Debit', align: 'right', render: (r) => (r.debit ? money(r.debit) : '') },
                    { key: 'c', header: 'Credit', align: 'right', render: (r) => (r.credit ? money(r.credit) : '') },
                  ]}
                />
              </div>
            )}
          </Async>
        </Card>
      </div>
    </>
  );
}
