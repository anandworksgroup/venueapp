import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAsync } from '../shared/hooks';
import { StatusPill } from '../shared/StatusPill';
import { Async, Banner, Card, EmptyState, PageHeader, Pill, Select, Tabs } from '../ui';
import type { VenueDetail } from '../types';
import { useBiz } from './context';
import { CancellationPolicyEditor, FacilitiesForm, LocationEditor, loadVenue, PackagesEditor, PhotosEditor, PricingReview, SpacesEditor, VenueDetailsForm } from './steps/VenueForms';

type Tab = 'details' | 'location' | 'spaces' | 'packages' | 'photos' | 'facilities' | 'policy';
const TABS: { key: Tab; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'location', label: 'Location' },
  { key: 'spaces', label: 'Spaces & pricing' },
  { key: 'packages', label: 'Packages' },
  { key: 'photos', label: 'Photos' },
  { key: 'facilities', label: 'Facilities' },
  { key: 'policy', label: 'Cancellation policy' },
];

export function VenuePage() {
  const { me, reloadMe } = useBiz();
  const { venueId } = useParams();
  const navigate = useNavigate();
  const venues = me.venues || [];
  const id = venueId || venues[0]?.id;
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'details') as Tab;
  const state = useAsync(() => (id ? loadVenue(id) : Promise.resolve(null as unknown as VenueDetail)), [id]);
  const [version, setVersion] = useState(0);
  if (!id) return <EmptyState title="No venue yet" body="Finish onboarding to add your venue." />;
  const onSaved = (v: VenueDetail) => {
    state.setData(v);
    setVersion((x) => x + 1);
    reloadMe();
  };
  const onChanged = () => {
    state.reload();
    reloadMe();
  };
  return (
    <Async state={state}>
      {(v) => (
        <>
          <PageHeader
            title={v.name}
            subtitle={[v.venue_type_label, v.area, v.city].filter(Boolean).join(' · ')}
            actions={
              <div className="row">
                {venues.length > 1 && <Select aria-label="Venue" value={id} onChange={(e) => navigate(`/business/venue/${e.target.value}`)} options={venues.map((x) => ({ value: x.id, label: x.name }))} />}
                <StatusPill status={v.status} />
                {v.location_verified ? <Pill tone="success">Location verified</Pill> : <Pill tone="warning">Location not verified</Pill>}
              </div>
            }
          />
          {v.rejection_reason && v.status === 'DRAFT' && (
            <div style={{ marginBottom: 16 }}>
              <Banner tone="danger" title="Pandal asked for changes">
                {v.rejection_reason}
              </Banner>
            </div>
          )}
          {v.status === 'ARCHIVED' && (
            <div style={{ marginBottom: 16 }}>
              <Banner tone="warning" title="This venue is archived and can't be edited." />
            </div>
          )}
          <Card pad={false}>
            <div style={{ padding: '6px 12px 0' }}>
              <Tabs items={TABS} value={tab} onChange={(t) => setParams({ tab: t })} />
            </div>
            <div style={{ padding: 20 }} key={`${v.id}-${tab}-${version}`}>
              {tab === 'details' && <VenueDetailsForm venue={v} onSaved={onSaved} />}
              {tab === 'location' && (
                <LocationEditor
                  venue={v}
                  onSaved={(nv) => {
                    state.setData(nv);
                    reloadMe();
                  }}
                />
              )}
              {tab === 'spaces' && (
                <div className="stack">
                  <SpacesEditor venue={v} onChanged={onChanged} />
                  <hr className="divider" />
                  <h3>Price overview</h3>
                  <PricingReview venue={v} />
                </div>
              )}
              {tab === 'packages' && <PackagesEditor venue={v} onChanged={onChanged} />}
              {tab === 'photos' && <PhotosEditor venue={v} onChanged={onChanged} />}
              {tab === 'facilities' && <FacilitiesForm venue={v} onSaved={onSaved} />}
              {tab === 'policy' && <CancellationPolicyEditor venue={v} onSaved={onSaved} />}
            </div>
          </Card>
        </>
      )}
    </Async>
  );
}
