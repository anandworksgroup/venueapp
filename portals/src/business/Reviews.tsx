import { useState } from 'react';
import { bizApi, errMsg } from '../api';
import { dateTime, titleCase } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { Async, Button, Card, EmptyState, InlineError, PageHeader, Pill, Textarea, useToast } from '../ui';

interface Review {
  id: string;
  overall: number;
  body: string | null;
  business_reply: string | null;
  status: string;
  venue_name: string;
  customer_name: string;
  code: string;
  created_at: string;
  food: number | null;
  service: number | null;
  cleanliness: number | null;
  value: number | null;
  venue_rating: number | null;
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

export function ReviewsPage() {
  const state = useAsync(() => bizApi.get<{ items: Review[] }>('/business/reviews'), []);
  return (
    <>
      <PageHeader title="Reviews" subtitle="Verified reviews from customers after their events. A thoughtful reply builds trust." />
      <Async state={state}>
        {(d) =>
          d.items.length === 0 ? (
            <Card>
              <EmptyState title="No reviews yet" body="Customers are invited to review after you mark an event completed." />
            </Card>
          ) : (
            <div className="stack">
              {d.items.map((r) => (
                <ReviewCard key={r.id} r={r} onSaved={state.reload} />
              ))}
            </div>
          )
        }
      </Async>
    </>
  );
}

function ReviewCard({ r, onSaved }: { r: Review; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState(r.business_reply || '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const save = async () => {
    if (!reply.trim()) return setError('Write a reply first');
    setPending(true);
    setError(null);
    try {
      await bizApi.post(`/business/reviews/${r.id}/reply`, { reply: reply.trim() });
      toast('Reply posted');
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  const sub = (['venue_rating', 'food', 'service', 'cleanliness', 'value'] as const).filter((k) => r[k]);
  return (
    <Card>
      <div className="row-between">
        <div>
          <div className="row">
            <span className="stars" aria-label={`${r.overall} out of 5`}>
              {stars(r.overall)}
            </span>
            <strong>{r.customer_name}</strong>
            {r.status === 'HIDDEN' && <Pill tone="danger">Hidden by Pandal</Pill>}
          </div>
          <div className="muted small">
            {r.venue_name} · {r.code} · {dateTime(r.created_at)}
          </div>
        </div>
      </div>
      {r.body && <p style={{ marginTop: 10 }}>{r.body}</p>}
      {sub.length > 0 && (
        <div className="chips" style={{ marginTop: 8 }}>
          {sub.map((k) => (
            <Pill key={k}>
              {titleCase(k.replace('_rating', ''))}: {r[k]}/5
            </Pill>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        {r.business_reply && !editing ? (
          <div className="banner banner-info" style={{ display: 'block' }}>
            <strong>Your reply</strong>
            <p>{r.business_reply}</p>
            <button type="button" className="link-btn" onClick={() => setEditing(true)}>
              Edit reply
            </button>
          </div>
        ) : editing || !r.business_reply ? (
          editing ? (
            <div className="stack-sm">
              <Textarea value={reply} maxLength={1000} onChange={(e) => setReply(e.target.value)} placeholder="Thank the customer, address any concerns…" autoFocus />
              <InlineError message={error} />
              <div className="row">
                <Button size="sm" onClick={save} pending={pending}>
                  Post reply
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Reply
            </Button>
          )
        ) : null}
      </div>
    </Card>
  );
}
