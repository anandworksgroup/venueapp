import { Link } from 'react-router-dom';
import { bizApi } from '../api';
import { Timeline } from '../shared/Brand';
import { dateTime, titleCase } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { StatusPill } from '../shared/StatusPill';
import { Async, Banner, Card, PageHeader } from '../ui';
import type { VerificationEvent } from '../types';
import { useBiz } from './context';

const STAGES = [
  { key: 'SUBMITTED', label: 'Submitted', body: 'We received your application.' },
  { key: 'UNDER_REVIEW', label: 'Under review', body: 'Our team is checking your details and documents.' },
  { key: 'DOCUMENTS_VERIFIED', label: 'Documents verified', body: 'Your documents checked out.' },
  { key: 'APPROVED', label: 'Approved', body: 'Your business is approved.' },
  { key: 'PUBLISHED', label: 'Published', body: 'Your venue is live for customers.' },
];

export function Verification() {
  const { me } = useBiz();
  const state = useAsync(() => bizApi.get<{ status: string; rejection_reason: string | null; events: VerificationEvent[] }>('/business/verification'), []);
  const venueNames = Object.fromEntries((me.venues || []).map((v) => [v.id, v.name]));
  return (
    <>
      <PageHeader title="Verification status" subtitle="Follow your application from submission to going live." />
      <Async state={state}>
        {(d) => {
          const bizEvents = d.events.filter((e) => e.entity_type === 'business');
          // Stages are monotonic: reaching "Approved" implies the earlier ones.
          const order = STAGES.map((s) => s.key);
          const maxReached = Math.max(order.indexOf(d.status), ...bizEvents.map((e) => order.indexOf(e.to_status)), d.status !== 'DRAFT' && bizEvents.length ? 0 : -1);
          const reached = (k: string) => {
            if (k === 'PUBLISHED') return (me.venues || []).some((v) => v.status === 'PUBLISHED');
            return order.indexOf(k) <= maxReached;
          };
          const rejected = d.status === 'REJECTED' || d.status === 'SUSPENDED';
          const firstPending = STAGES.findIndex((s) => !reached(s.key));
          return (
            <div className="split">
              <div className="stack">
                {rejected && (
                  <Banner
                    tone="danger"
                    title={d.status === 'REJECTED' ? 'Your application needs changes' : 'Your business is suspended'}
                    action={
                      d.status === 'REJECTED' ? (
                        <Link className="btn btn-primary btn-sm" to="/business/onboarding">
                          Fix & resubmit
                        </Link>
                      ) : undefined
                    }
                  >
                    {d.rejection_reason || 'Contact Pandal support for details.'}
                  </Banner>
                )}
                <Card title="Progress" actions={<StatusPill status={d.status} />}>
                  <Timeline
                    items={STAGES.map((s, i) => {
                      const ev = s.key === 'PUBLISHED' ? d.events.find((e) => e.entity_type === 'venue' && e.to_status === 'PUBLISHED') : bizEvents.filter((e) => e.to_status === s.key).pop();
                      const isDone = reached(s.key);
                      return {
                        title: s.label,
                        meta: ev ? dateTime(ev.at) : isDone ? 'Done' : i === firstPending && !rejected ? 'In progress' : 'Pending',
                        body: isDone || i === firstPending ? s.body : undefined,
                        tone: isDone ? 'done' : i === firstPending && !rejected ? 'current' : 'todo',
                      };
                    })}
                  />
                </Card>
              </div>
              <Card title="Activity">
                {d.events.length === 0 ? (
                  <p className="muted">No activity yet. Submit your application to start verification.</p>
                ) : (
                  <Timeline
                    items={[...d.events].reverse().map((e) => ({
                      title: (
                        <>
                          {e.entity_type === 'venue' ? `Venue${venueNames[e.entity_id] ? ` · ${venueNames[e.entity_id]}` : ''}` : 'Business'}: {titleCase(e.from_status)} → {titleCase(e.to_status)}
                        </>
                      ),
                      meta: dateTime(e.at),
                      body: e.note,
                      tone: ['REJECTED', 'SUSPENDED'].includes(e.to_status) || (e.entity_type === 'venue' && e.to_status === 'DRAFT' && e.from_status !== null) ? 'danger' : 'done',
                    }))}
                  />
                )}
              </Card>
            </div>
          );
        }}
      </Async>
    </>
  );
}
