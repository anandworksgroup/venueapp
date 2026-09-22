import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api';
import { dateTime } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { StatusPill } from '../shared/StatusPill';
import { Async, Button, Card, Chips, ConfirmDialog, EmptyState, PageHeader, Table, useToast } from '../ui';

interface Review {
  id: string;
  booking_id: string;
  overall: number;
  body: string | null;
  business_reply: string | null;
  status: string;
  venue_name: string;
  customer_name: string;
  code: string;
  created_at: string;
}

export function ReviewsModeration() {
  const [status, setStatus] = useState('');
  const state = useAsync(() => adminApi.get<{ items: Review[] }>('/admin/reviews', { status }), [status]);
  const [target, setTarget] = useState<{ r: Review; to: 'HIDDEN' | 'PUBLISHED' } | null>(null);
  const toast = useToast();
  return (
    <>
      <PageHeader title="Reviews" subtitle="Hide reviews that break the guidelines (abuse, personal data, fake). Ratings recompute automatically." />
      <div style={{ marginBottom: 14 }}>
        <Chips value={status} onChange={setStatus} items={[{ key: '', label: 'All' }, { key: 'PUBLISHED', label: 'Published' }, { key: 'HIDDEN', label: 'Hidden' }]} />
      </div>
      <Card pad={false}>
        <Async state={state}>
          {(d) => (
            <Table
              rows={d.items}
              rowKey={(r) => r.id}
              empty={<EmptyState title="No reviews" />}
              columns={[
                { key: 'r', header: 'Rating', render: (r) => <span className="stars">{'★'.repeat(r.overall)}{'☆'.repeat(5 - r.overall)}</span> },
                { key: 'b', header: 'Review', render: (r) => (<><div>{r.body || <span className="muted">No text</span>}</div>{r.business_reply && <div className="cell-sub">Reply: {r.business_reply}</div>}</>) },
                { key: 'v', header: 'Venue', render: (r) => (<><div>{r.venue_name}</div><div className="cell-sub">{r.customer_name} · <Link to={`/admin/bookings/${r.booking_id}`}>{r.code}</Link></div></>) },
                { key: 'd', header: 'Date', render: (r) => dateTime(r.created_at), hideSm: true },
                { key: 's', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
                {
                  key: 'x',
                  header: '',
                  align: 'right',
                  render: (r) =>
                    r.status === 'PUBLISHED' ? (
                      <Button size="sm" variant="ghost" onClick={() => setTarget({ r, to: 'HIDDEN' })}>
                        Hide
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setTarget({ r, to: 'PUBLISHED' })}>
                        Publish
                      </Button>
                    ),
                },
              ]}
            />
          )}
        </Async>
      </Card>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={target?.to === 'HIDDEN' ? 'Hide this review?' : 'Publish this review again?'}
        message={target?.to === 'HIDDEN' ? 'It disappears from the venue page and stops counting towards the rating.' : 'It becomes visible and counts towards the rating again.'}
        confirmLabel={target?.to === 'HIDDEN' ? 'Hide review' : 'Publish review'}
        danger={target?.to === 'HIDDEN'}
        reasonLabel="Reason"
        reasonOptional={target?.to === 'PUBLISHED'}
        onConfirm={async (reason) => {
          await adminApi.post(`/admin/reviews/${target!.r.id}/status`, { status: target!.to, reason: reason || undefined });
          toast('Review updated');
          state.reload();
        }}
      />
    </>
  );
}

interface Dispute {
  id: string;
  booking_id: string;
  booking_code: string;
  customer_name: string;
  raised_role: string;
  subject: string;
  body: string;
  status: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function DisputesPage() {
  const state = useAsync(() => adminApi.get<{ items: Dispute[] }>('/admin/disputes'), []);
  const [filter, setFilter] = useState('open');
  const [target, setTarget] = useState<{ d: Dispute; to: 'IN_REVIEW' | 'RESOLVED' | 'REJECTED' } | null>(null);
  const toast = useToast();
  return (
    <>
      <PageHeader title="Disputes" subtitle="Issues raised by customers about a booking." />
      <div style={{ marginBottom: 14 }}>
        <Chips value={filter} onChange={setFilter} items={[{ key: 'open', label: 'Open' }, { key: 'closed', label: 'Closed' }, { key: 'all', label: 'All' }]} />
      </div>
      <Async state={state}>
        {(d) => {
          const items = d.items.filter((x) => (filter === 'all' ? true : filter === 'open' ? ['OPEN', 'IN_REVIEW'].includes(x.status) : ['RESOLVED', 'REJECTED'].includes(x.status)));
          if (!items.length)
            return (
              <Card>
                <EmptyState title={filter === 'open' ? 'No open disputes' : 'No disputes'} />
              </Card>
            );
          return (
            <div className="stack">
              {items.map((x) => (
                <Card
                  key={x.id}
                  title={x.subject}
                  subtitle={
                    <>
                      <Link to={`/admin/bookings/${x.booking_id}`} className="mono">{x.booking_code}</Link> · {x.customer_name} · raised {dateTime(x.created_at)}
                    </>
                  }
                  actions={<StatusPill status={x.status} />}
                >
                  <p>{x.body}</p>
                  {x.resolution && (
                    <p className="muted">
                      <strong>Resolution:</strong> {x.resolution}
                    </p>
                  )}
                  {['OPEN', 'IN_REVIEW'].includes(x.status) && (
                    <div className="row mt">
                      {x.status === 'OPEN' && (
                        <Button size="sm" variant="secondary" onClick={() => setTarget({ d: x, to: 'IN_REVIEW' })}>
                          Mark in review
                        </Button>
                      )}
                      <Button size="sm" variant="success" onClick={() => setTarget({ d: x, to: 'RESOLVED' })}>
                        Resolve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setTarget({ d: x, to: 'REJECTED' })}>
                        Reject
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          );
        }}
      </Async>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={target?.to === 'IN_REVIEW' ? 'Start reviewing this dispute?' : target?.to === 'RESOLVED' ? 'Resolve this dispute?' : 'Reject this dispute?'}
        message={target?.to === 'IN_REVIEW' ? undefined : 'The customer is notified with your resolution.'}
        confirmLabel={target?.to === 'IN_REVIEW' ? 'Mark in review' : target?.to === 'RESOLVED' ? 'Resolve' : 'Reject'}
        danger={target?.to === 'REJECTED'}
        reasonLabel={target?.to === 'IN_REVIEW' ? 'Note' : 'Resolution'}
        reasonOptional={target?.to === 'IN_REVIEW'}
        onConfirm={async (resolution) => {
          await adminApi.post(`/admin/disputes/${target!.d.id}/resolve`, { status: target!.to, resolution: resolution || undefined });
          toast('Dispute updated');
          state.reload();
        }}
      />
    </>
  );
}
