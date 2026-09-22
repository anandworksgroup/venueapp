import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { adminApi, errMsg } from '../api';
import { Timeline } from '../shared/Brand';
import { dateTime, docLabel, pct, titleCase } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { Icons } from '../shared/icons';
import { StatusPill } from '../shared/StatusPill';
import { Async, Banner, Button, Card, Chips, ConfirmDialog, EmptyState, Field, InlineError, KeyValue, NumberInput, PageHeader, Pill, Table, useToast } from '../ui';
import type { VerificationEvent } from '../types';
import { useAdmin } from './context';
import { SearchBox, useDebounced } from './Customers';

const BIZ_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'DOCUMENTS_VERIFIED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DRAFT'];

interface BizRow {
  id: string;
  name: string;
  type: string;
  owner_name: string;
  phone: string;
  email: string | null;
  city: string | null;
  status: string;
  commission_bps: number;
  created_at: string;
  submitted_at: string | null;
  venues: number;
  documents: number;
}

export const BackLink = ({ to, label }: { to: string; label: string }) => (
  <Link to={to} className="back-link">
    {Icons.chevronLeft} {label}
  </Link>
);

export function BusinessesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const state = useAsync(() => adminApi.get<{ items: BizRow[]; counts: { status: string; c: number }[] }>('/admin/businesses', { status, q: search, limit: 200 }), [status, search]);
  const navigate = useNavigate();
  const counts = Object.fromEntries((state.data?.counts || []).map((c) => [c.status, c.c]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader title="Businesses" subtitle="Verify new partners and manage existing ones." actions={<SearchBox value={q} onChange={setQ} placeholder="Search name, email or phone" />} />
      <div style={{ marginBottom: 14 }}>
        <Chips
          value={status}
          onChange={(s) => setParams(s ? { status: s } : {})}
          items={[{ key: '', label: 'All', count: total }, ...BIZ_STATUSES.map((s) => ({ key: s, label: titleCase(s), count: counts[s] || 0 }))]}
        />
      </div>
      <Card pad={false}>
        <Async state={state}>
          {(d) => (
            <Table
              rows={d.items}
              rowKey={(b) => b.id}
              onRowClick={(b) => navigate(`/admin/businesses/${b.id}`)}
              empty={<EmptyState title="No businesses here" body={status ? `Nothing is ${titleCase(status).toLowerCase()} right now.` : undefined} />}
              columns={[
                { key: 'n', header: 'Business', render: (b) => (<><div className="cell-main">{b.name}</div><div className="cell-sub">{b.owner_name} · {b.email || b.phone}</div></>) },
                { key: 'c', header: 'City', render: (b) => b.city || '—' },
                { key: 'v', header: 'Venues', align: 'right', render: (b) => b.venues },
                { key: 'd', header: 'Docs', align: 'right', render: (b) => b.documents },
                { key: 'cm', header: 'Commission', align: 'right', render: (b) => pct(b.commission_bps), hideSm: true },
                { key: 's', header: 'Submitted', render: (b) => (b.submitted_at ? dateTime(b.submitted_at) : '—'), hideSm: true },
                { key: 'st', header: 'Status', render: (b) => <StatusPill status={b.status} /> },
              ]}
            />
          )}
        </Async>
      </Card>
    </>
  );
}

interface BizDetail {
  business: Record<string, unknown> & { id: string; name: string; legal_name: string | null; owner_name: string; phone: string; email: string | null; gstin: string | null; pan: string | null; bank: { holder: string; ifsc: string; account: string } | null; address: string | null; city: string | null; state: string | null; pincode: string | null; status: string; rejection_reason: string | null; commission_bps: number; created_at: string; submitted_at: string | null; approved_at: string | null; type: string };
  venues: { id: string; name: string; status: string; venue_type: string; city: string | null; area_name: string | null; location_verified: number; lat: number | null; lng: number | null; address: string | null; pincode: string | null }[];
  documents: { id: string; kind: string; file_name: string; mime: string; status: string; note: string | null; uploaded_at: string }[];
  events: VerificationEvent[];
  allowed_transitions: string[];
}

const TRANSITION_LABEL: Record<string, string> = {
  UNDER_REVIEW: 'Start review',
  DOCUMENTS_VERIFIED: 'Mark documents verified',
  APPROVED: 'Approve business',
  REJECTED: 'Reject',
  SUSPENDED: 'Suspend',
};

export function openBlobInNewTab(load: () => Promise<Blob>) {
  // Open synchronously (popup blockers), then point it at the blob URL.
  const w = window.open('', '_blank');
  if (w) w.document.write('<p style="font-family:system-ui;padding:24px">Opening document…</p>');
  return load().then(
    (blob) => {
      const url = URL.createObjectURL(blob);
      if (w) w.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    (e) => {
      w?.close();
      throw e;
    },
  );
}

export function BusinessDetailPage() {
  const { id } = useParams();
  const state = useAsync(() => adminApi.get<BizDetail>(`/admin/businesses/${id}`), [id]);
  const { can } = useAdmin();
  const toast = useToast();
  const [transition, setTransition] = useState<string | null>(null);
  const [docReject, setDocReject] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commission, setCommission] = useState<number | ''>('');
  const [commPending, setCommPending] = useState(false);

  const reviewDoc = async (docId: string, status: 'VERIFIED' | 'REJECTED', note?: string) => {
    await adminApi.post(`/admin/documents/${docId}/review`, { status, note });
    toast(status === 'VERIFIED' ? 'Document verified' : 'Document rejected');
    state.reload();
  };
  const verifyDoc = async (docId: string) => {
    setBusy(docId);
    setError(null);
    try {
      await reviewDoc(docId, 'VERIFIED');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  const openDoc = async (docId: string) => {
    setError(null);
    try {
      await openBlobInNewTab(() => adminApi.blob(`/admin/documents/${docId}`));
    } catch (e) {
      setError(errMsg(e));
    }
  };
  const saveCommission = async () => {
    if (commission === '') return;
    setCommPending(true);
    setError(null);
    try {
      await adminApi.post(`/admin/businesses/${id}/commission`, { commission_bps: Math.round(Number(commission) * 100) });
      toast('Commission updated');
      setCommission('');
      state.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCommPending(false);
    }
  };

  return (
    <Async state={state}>
      {(d) => {
        const b = d.business;
        const needsReason = transition === 'REJECTED' || transition === 'SUSPENDED';
        const pendingDocs = d.documents.filter((x) => x.status !== 'VERIFIED').length;
        return (
          <>
            <PageHeader
              back={<BackLink to="/admin/businesses" label="Businesses" />}
              title={b.name}
              subtitle={`${titleCase(b.type)} · ${b.city || 'City not set'} · joined ${dateTime(b.created_at)}`}
              actions={<StatusPill status={b.status} />}
            />
            <div className="stack">
              {b.rejection_reason && ['REJECTED', 'SUSPENDED'].includes(b.status) && (
                <Banner tone="danger" title={b.status === 'REJECTED' ? 'Rejected' : 'Suspended'}>
                  {b.rejection_reason}
                </Banner>
              )}
              {can('businesses.verify') && d.allowed_transitions.length > 0 && (
                <Card title="Verification actions" subtitle={d.allowed_transitions.includes('DOCUMENTS_VERIFIED') && pendingDocs ? `${pendingDocs} document(s) still need a decision before "Documents verified".` : undefined}>
                  <div className="row">
                    {d.allowed_transitions.map((t) => (
                      <Button key={t} variant={t === 'REJECTED' || t === 'SUSPENDED' ? 'danger' : t === 'APPROVED' ? 'success' : 'primary'} onClick={() => setTransition(t)}>
                        {TRANSITION_LABEL[t] || titleCase(t)}
                      </Button>
                    ))}
                  </div>
                </Card>
              )}
              <InlineError message={error} />
              <div className="split">
                <div className="stack">
                  <Card title="Profile">
                    <KeyValue
                      items={[
                        ['Legal name', b.legal_name],
                        ['Owner', b.owner_name],
                        ['Phone', b.phone],
                        ['Email', b.email],
                        ['Address', [b.address, b.city, b.state, b.pincode].filter(Boolean).join(', ') || '—'],
                        ['GSTIN', b.gstin],
                        ['PAN', b.pan],
                        ['Submitted', b.submitted_at ? dateTime(b.submitted_at) : '—'],
                        ['Approved', b.approved_at ? dateTime(b.approved_at) : '—'],
                      ]}
                    />
                  </Card>
                  <Card title="Bank account" subtitle={can('payouts.manage') ? 'Full number visible to your role. This view is audit-logged.' : 'Masked for your role.'}>
                    {b.bank ? (
                      <KeyValue
                        items={[
                          ['Holder', b.bank.holder],
                          ['Account', <span className="mono">{b.bank.account}</span>],
                          ['IFSC', b.bank.ifsc],
                        ]}
                      />
                    ) : (
                      <p className="muted">No bank details yet.</p>
                    )}
                  </Card>
                  <Card title="Documents">
                    {d.documents.length === 0 ? (
                      <EmptyState title="No documents uploaded" />
                    ) : (
                      d.documents.map((doc) => (
                        <div key={doc.id} className="doc-row">
                          <div>
                            <div className="cell-main">{docLabel(doc.kind)}</div>
                            <div className="cell-sub">
                              {doc.file_name} · {dateTime(doc.uploaded_at)}
                            </div>
                            {doc.note && <div className="small">Note: {doc.note}</div>}
                          </div>
                          <div className="row">
                            <StatusPill status={doc.status} />
                            {can('businesses.verify') && (
                              <>
                                <Button size="sm" variant="secondary" onClick={() => openDoc(doc.id)}>
                                  Open
                                </Button>
                                {doc.status !== 'VERIFIED' && (
                                  <Button size="sm" variant="success" pending={busy === doc.id} onClick={() => verifyDoc(doc.id)}>
                                    Verify
                                  </Button>
                                )}
                                {doc.status !== 'REJECTED' && (
                                  <Button size="sm" variant="ghost" onClick={() => setDocReject(doc.id)}>
                                    Reject
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </Card>
                  <Card title="Venues">
                    <Table
                      rows={d.venues}
                      rowKey={(v) => v.id}
                      empty={<EmptyState title="No venues yet" />}
                      columns={[
                        { key: 'n', header: 'Venue', render: (v) => (<Link to={`/admin/venues/${v.id}`} className="cell-main">{v.name}</Link>) },
                        { key: 'a', header: 'Area', render: (v) => [v.area_name, v.city].filter(Boolean).join(', ') || '—' },
                        { key: 'l', header: 'Location', render: (v) => (v.lat == null ? <Pill tone="danger">No pin</Pill> : v.location_verified ? <Pill tone="success">Verified</Pill> : <Pill tone="warning">Unverified</Pill>) },
                        { key: 's', header: 'Status', render: (v) => <StatusPill status={v.status} /> },
                      ]}
                    />
                  </Card>
                </div>
                <div className="stack">
                  <Card title="Commission">
                    <p>
                      Current rate: <strong>{pct(b.commission_bps)}</strong> <span className="muted">({b.commission_bps} bps)</span>
                    </p>
                    {can('payouts.manage') ? (
                      <div className="row" style={{ alignItems: 'end', marginTop: 10 }}>
                        <Field label="New rate (%)">
                          <NumberInput min={0} max={50} step={0.25} value={commission} onChange={setCommission} placeholder={(b.commission_bps / 100).toString()} />
                        </Field>
                        <Button onClick={saveCommission} pending={commPending} disabled={commission === ''}>
                          Update
                        </Button>
                      </div>
                    ) : (
                      <p className="muted small">Only finance can change commission.</p>
                    )}
                  </Card>
                  <Card title="Verification timeline">
                    {d.events.length === 0 ? (
                      <p className="muted">No events yet.</p>
                    ) : (
                      <Timeline
                        items={d.events.map((e) => ({
                          title: `${titleCase(e.from_status) || 'New'} → ${titleCase(e.to_status)}`,
                          meta: dateTime(e.at),
                          body: e.note,
                          tone: ['REJECTED', 'SUSPENDED'].includes(e.to_status) ? 'danger' : 'done',
                        }))}
                      />
                    )}
                  </Card>
                </div>
              </div>
            </div>
            <ConfirmDialog
              open={!!transition}
              onClose={() => setTransition(null)}
              title={`${TRANSITION_LABEL[transition || ''] || titleCase(transition)}: ${b.name}?`}
              message={
                transition === 'APPROVED'
                  ? 'The business can then have its venues published.'
                  : transition === 'REJECTED'
                    ? 'The business will be asked to fix and resubmit. Its submitted venues return to draft.'
                    : transition === 'SUSPENDED'
                      ? 'All published venues of this business will be suspended immediately.'
                      : `Move from ${titleCase(b.status)} to ${titleCase(transition)}.`
              }
              confirmLabel={TRANSITION_LABEL[transition || ''] || 'Confirm'}
              danger={needsReason}
              reasonLabel={needsReason ? 'Reason (shared with the business)' : 'Internal note'}
              reasonOptional={!needsReason}
              onConfirm={async (reason) => {
                await adminApi.post(`/admin/businesses/${b.id}/transition`, { to: transition, reason: reason || undefined });
                toast(`Business moved to ${titleCase(transition)}`);
                state.reload();
              }}
            />
            <ConfirmDialog
              open={!!docReject}
              onClose={() => setDocReject(null)}
              title="Reject this document?"
              message="The business sees your note and can upload a replacement."
              confirmLabel="Reject document"
              danger
              reasonLabel="Reason"
              onConfirm={(note) => reviewDoc(docReject!, 'REJECTED', note)}
            />
          </>
        );
      }}
    </Async>
  );
}
