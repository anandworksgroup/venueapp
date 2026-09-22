import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { adminApi, errMsg } from '../api';
import { Timeline } from '../shared/Brand';
import { dateTime, mediaUrl, money, titleCase } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { MapView } from '../shared/MapPicker';
import { StatusPill } from '../shared/StatusPill';
import { Async, Banner, Button, Card, Chips, ConfirmDialog, EmptyState, KeyValue, PageHeader, Pill, Table, useToast } from '../ui';
import type { VenueDetail, VerificationEvent } from '../types';
import { useAdmin } from './context';
import { SearchBox, useDebounced } from './Customers';
import { BackLink } from './Businesses';

const VENUE_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'SUSPENDED', 'DRAFT', 'ARCHIVED'];

interface VenueRow {
  id: string;
  name: string;
  venue_type: string;
  city: string | null;
  area_name: string | null;
  status: string;
  location_verified: number;
  rating_avg: number;
  rating_count: number;
  starting_price: number | null;
  capacity_max: number | null;
  booking_count: number;
  business_name: string;
  business_status: string;
}

export function VenuesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const state = useAsync(() => adminApi.get<{ items: VenueRow[]; counts: { status: string; c: number }[] }>('/admin/venues', { status, q: search, limit: 200 }), [status, search]);
  const navigate = useNavigate();
  const counts = Object.fromEntries((state.data?.counts || []).map((c) => [c.status, c.c]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader title="Venues" subtitle="Inventory: review, verify location, publish." actions={<SearchBox value={q} onChange={setQ} placeholder="Search name, city or area" />} />
      <div style={{ marginBottom: 14 }}>
        <Chips value={status} onChange={(s) => setParams(s ? { status: s } : {})} items={[{ key: '', label: 'All', count: total }, ...VENUE_STATUSES.map((s) => ({ key: s, label: titleCase(s), count: counts[s] || 0 }))]} />
      </div>
      <Card pad={false}>
        <Async state={state}>
          {(d) => (
            <Table
              rows={d.items}
              rowKey={(v) => v.id}
              onRowClick={(v) => navigate(`/admin/venues/${v.id}`)}
              empty={<EmptyState title="No venues here" />}
              columns={[
                { key: 'n', header: 'Venue', render: (v) => (<><div className="cell-main">{v.name}</div><div className="cell-sub">{v.business_name}</div></>) },
                { key: 'a', header: 'Area', render: (v) => [v.area_name, v.city].filter(Boolean).join(', ') || '—' },
                { key: 't', header: 'Type', render: (v) => titleCase(v.venue_type), hideSm: true },
                { key: 'p', header: 'From', align: 'right', render: (v) => money(v.starting_price), hideSm: true },
                { key: 'c', header: 'Capacity', align: 'right', render: (v) => v.capacity_max ?? '—', hideSm: true },
                { key: 'r', header: 'Rating', align: 'right', render: (v) => (v.rating_count ? `${v.rating_avg} (${v.rating_count})` : '—'), hideSm: true },
                { key: 'l', header: 'Location', render: (v) => (v.location_verified ? <Pill tone="success">Verified</Pill> : <Pill tone="warning">Unverified</Pill>) },
                { key: 's', header: 'Status', render: (v) => <StatusPill status={v.status} /> },
              ]}
            />
          )}
        </Async>
      </Card>
    </>
  );
}

type AdminVenue = VenueDetail & { business: { id: string; name: string; status: string }; events: VerificationEvent[]; allowed_transitions: string[] };

const T_LABEL: Record<string, string> = {
  UNDER_REVIEW: 'Start review',
  APPROVED: 'Approve',
  PUBLISHED: 'Publish',
  DRAFT: 'Reject (back to draft)',
  SUSPENDED: 'Suspend',
  ARCHIVED: 'Archive',
};

export function VenueDetailPage() {
  const { id } = useParams();
  const state = useAsync(() => adminApi.get<AdminVenue>(`/admin/venues/${id}`), [id]);
  const { can } = useAdmin();
  const toast = useToast();
  const [transition, setTransition] = useState<string | null>(null);
  const [locDialog, setLocDialog] = useState<'verify' | 'reject' | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  return (
    <Async state={state}>
      {(v) => {
        const needsReason = ['DRAFT', 'SUSPENDED', 'ARCHIVED'].includes(transition || '');
        const blockers: string[] = [];
        if (v.allowed_transitions.includes('PUBLISHED')) {
          if (v.business.status !== 'APPROVED') blockers.push(`Business is ${titleCase(v.business.status)}, not approved`);
          if (!v.location_verified) blockers.push('Location is not verified');
        }
        return (
          <>
            <PageHeader
              back={<BackLink to="/admin/venues" label="Venues" />}
              title={v.name}
              subtitle={
                <>
                  {v.venue_type_label} · <Link to={`/admin/businesses/${v.business.id}`}>{v.business.name}</Link> <StatusPill status={v.business.status} />
                </>
              }
              actions={<StatusPill status={v.status} />}
            />
            <div className="stack">
              {v.rejection_reason && v.status === 'DRAFT' && <Banner tone="danger" title="Sent back to the business">{v.rejection_reason}</Banner>}
              {can('venues.verify') && v.allowed_transitions.length > 0 && (
                <Card title="Review actions" subtitle={blockers.length ? `Before publishing: ${blockers.join(' · ')}` : undefined}>
                  <div className="row">
                    {v.allowed_transitions.map((t) => (
                      <Button key={t} variant={needsReasonFor(t) ? 'danger' : t === 'PUBLISHED' ? 'success' : 'primary'} onClick={() => (setError(null), setTransition(t))}>
                        {T_LABEL[t] || titleCase(t)}
                      </Button>
                    ))}
                  </div>
                </Card>
              )}
              {error && (
                <Banner tone="danger" title={error.code === 'BUSINESS_NOT_APPROVED' ? 'Business not approved yet' : error.code === 'LOCATION_UNVERIFIED' ? 'Location not verified' : error.code === 'NO_SPACES' ? 'No active spaces' : 'Action failed'}>
                  {error.message}
                </Banner>
              )}
              <div className="split">
                <div className="stack">
                  <Card
                    title="Location check"
                    subtitle="Compare the pin with the address. Zoom in: the pin should sit on the entrance."
                    actions={
                      v.location_verified ? <Pill tone="success">Verified</Pill> : <Pill tone="warning">Not verified</Pill>
                    }
                  >
                    {v.lat != null && v.lng != null ? (
                      <>
                        <MapView lat={v.lat} lng={v.lng} height={300} />
                        <KeyValue
                          items={[
                            ['Address', v.address],
                            ['Area / city', [v.area, v.city, v.state, v.pincode].filter(Boolean).join(', ')],
                            ['Coordinates', <span className="mono">{v.lat.toFixed(6)}, {v.lng.toFixed(6)}</span>],
                            ['Open in', <a href={`https://www.openstreetmap.org/?mlat=${v.lat}&mlon=${v.lng}#map=18/${v.lat}/${v.lng}`} target="_blank" rel="noreferrer">OpenStreetMap ↗</a>],
                          ]}
                        />
                        {can('venues.verify') && (
                          <div className="row mt">
                            {!v.location_verified && (
                              <Button variant="success" onClick={() => setLocDialog('verify')}>
                                Verify location
                              </Button>
                            )}
                            <Button variant="ghost" onClick={() => setLocDialog('reject')}>
                              {v.location_verified ? 'Revoke verification' : 'Mark pin wrong'}
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <EmptyState title="No map pin yet" body="The business hasn't placed its pin." />
                    )}
                  </Card>
                  <Card title="Gallery" subtitle={`${v.gallery.length} item(s)`}>
                    {v.gallery.length === 0 ? (
                      <p className="muted">No photos uploaded.</p>
                    ) : (
                      <div className="gallery">
                        {v.gallery.map((g) =>
                          g.media_type === 'photo' ? (
                            <a key={g.id} href={mediaUrl(g.url)} target="_blank" rel="noreferrer" title={titleCase(g.category)}>
                              <img src={mediaUrl(g.url)} alt={g.caption || g.category} loading="lazy" />
                            </a>
                          ) : (
                            <a key={g.id} href={g.url} target="_blank" rel="noreferrer" className="row" style={{ padding: 10 }}>
                              Video ↗
                            </a>
                          ),
                        )}
                      </div>
                    )}
                  </Card>
                  <Card title="Spaces & pricing">
                    <Table
                      rows={v.spaces}
                      rowKey={(s) => s.id}
                      empty={<EmptyState title="No active spaces" />}
                      columns={[
                        { key: 'n', header: 'Space', render: (s) => (<><div className="cell-main">{s.name}</div><div className="cell-sub">{titleCase(s.kind)} · {s.capacity_seated}/{s.capacity_floating} guests{s.min_guests ? ` · min ${s.min_guests}` : ''}</div></>) },
                        { key: 'm', header: 'Morning', align: 'right', render: (s) => money(s.prices.MORNING) },
                        { key: 'e', header: 'Evening', align: 'right', render: (s) => money(s.prices.EVENING) },
                        { key: 'f', header: 'Full day', align: 'right', render: (s) => money(s.prices.FULL_DAY) },
                        { key: 'w', header: 'Weekend', align: 'right', render: (s) => (s.weekend_surcharge_pct ? `+${s.weekend_surcharge_pct}%` : '—') },
                      ]}
                    />
                  </Card>
                  <Card title="Packages">
                    {v.packages.length === 0 ? (
                      <p className="muted">No packages.</p>
                    ) : (
                      v.packages.map((p) => (
                        <div key={p.id} className="editor-row">
                          <div className="row-between">
                            <strong>{p.name}</strong>
                            <span>{p.pricing_mode === 'included' ? 'Included' : p.pricing_mode === 'per_plate' ? `${money(p.price)} / plate` : money(p.price)}</span>
                          </div>
                          <div className="chips" style={{ marginTop: 6 }}>
                            <Pill tone="teal">{titleCase(p.tier)}</Pill>
                            {p.inclusions.map((i, k) => (
                              <Pill key={k}>{i.label}</Pill>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </Card>
                </div>
                <div className="stack">
                  <Card title="Details">
                    <KeyValue
                      items={[
                        ['Booking mode', titleCase(v.booking_mode)],
                        ['Advance', `${v.advance_pct}%`],
                        ['Starting price', money(v.starting_price)],
                        ['Capacity', v.capacity.max_guests ?? '—'],
                        ['Parking', v.capacity.parking_cars ? `${v.capacity.parking_cars} cars` : '—'],
                        ['Rooms', v.capacity.rooms ?? '—'],
                        ['Events', v.event_types.map(titleCase).join(', ') || '—'],
                        ['Facilities', v.facility_labels.map((f) => f.label).join(', ') || '—'],
                        ['Rating', v.rating_count ? `${v.rating_avg} (${v.rating_count})` : '—'],
                      ]}
                    />
                    {v.description && <p className="muted mt">{v.description}</p>}
                  </Card>
                  <Card title="Cancellation policy">
                    <KeyValue items={v.cancellation_policy.map((r) => [r.label, `${r.refund_pct}% refund`])} />
                  </Card>
                  <Card title="Verification timeline">
                    {v.events.length === 0 ? (
                      <p className="muted">No events yet.</p>
                    ) : (
                      <Timeline
                        items={v.events.map((e) => ({
                          title: e.from_status === e.to_status ? titleCase(e.to_status) : `${titleCase(e.from_status) || 'New'} → ${titleCase(e.to_status)}`,
                          meta: dateTime(e.at),
                          body: e.note,
                          tone: ['SUSPENDED', 'ARCHIVED'].includes(e.to_status) || (e.to_status === 'DRAFT' && e.from_status) ? 'danger' : 'done',
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
              title={`${T_LABEL[transition || ''] || titleCase(transition)}: ${v.name}?`}
              message={transition === 'PUBLISHED' ? 'The venue becomes visible and bookable for customers.' : transition === 'DRAFT' ? 'The business will be asked to make changes and resubmit.' : `Move from ${titleCase(v.status)} to ${titleCase(transition)}.`}
              confirmLabel={T_LABEL[transition || ''] || 'Confirm'}
              danger={needsReason}
              reasonLabel={needsReason ? 'Reason (shared with the business)' : 'Internal note'}
              reasonOptional={!needsReason}
              onConfirm={async (reason) => {
                setError(null);
                try {
                  await adminApi.post(`/admin/venues/${v.id}/transition`, { to: transition, reason: reason || undefined });
                  toast(`Venue moved to ${titleCase(transition)}`);
                  state.reload();
                } catch (e) {
                  const err = e as { code?: string; message: string };
                  setError({ code: err.code, message: errMsg(e) });
                  throw e;
                }
              }}
            />
            <ConfirmDialog
              open={!!locDialog}
              onClose={() => setLocDialog(null)}
              title={locDialog === 'verify' ? 'Verify this location?' : 'Mark the location as not verified?'}
              message={locDialog === 'verify' ? 'Confirm the pin sits on the venue entrance and matches the address.' : 'The venue cannot be published until the business fixes its pin and you verify it.'}
              confirmLabel={locDialog === 'verify' ? 'Verify location' : 'Mark unverified'}
              danger={locDialog === 'reject'}
              reasonLabel={locDialog === 'reject' ? 'Reason' : undefined}
              onConfirm={async (reason) => {
                setError(null);
                await adminApi.post(`/admin/venues/${v.id}/verify-location`, locDialog === 'verify' ? { verified: true } : { verified: false, reason });
                toast(locDialog === 'verify' ? 'Location verified' : 'Location marked unverified');
                state.reload();
              }}
            />
          </>
        );
      }}
    </Async>
  );
}

const needsReasonFor = (t: string) => ['DRAFT', 'SUSPENDED', 'ARCHIVED'].includes(t);
