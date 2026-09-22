import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, bizApi, errMsg } from '../api';
import { Wordmark } from '../shared/Brand';
import { Icons } from '../shared/icons';
import { StatusPill } from '../shared/StatusPill';
import { Banner, Button, Card, Field, IconButton, InlineError, Input, Loading, useToast } from '../ui';
import type { VenueDetail } from '../types';
import { needsOnboarding, useBiz } from './context';
import { AddressForm, BankForm, BusinessInfoForm, DocumentsStep, OwnerForm } from './steps/ProfileForms';
import { CancellationPolicyEditor, FacilitiesForm, LocationEditor, loadVenue, PackagesEditor, PhotosEditor, PricingReview, SpacesEditor, VenueDetailsForm } from './steps/VenueForms';

type StepKey = 'type' | 'business' | 'owner' | 'address' | 'venue' | 'location' | 'spaces' | 'facilities' | 'photos' | 'packages' | 'pricing' | 'availability' | 'bank' | 'documents' | 'submit';

const STEPS: { key: StepKey; label: string; title: string; subtitle: string; needs?: 'business' | 'venue' }[] = [
  { key: 'type', label: 'Get started', title: 'I want to list my business', subtitle: 'Tell us what kind of business you run.' },
  { key: 'business', label: 'Business info', title: 'Business information', subtitle: 'How customers will see your business.', needs: 'business' },
  { key: 'owner', label: 'Owner', title: 'Owner information', subtitle: 'Who we contact about bookings and payouts.', needs: 'business' },
  { key: 'address', label: 'Address', title: 'Business address', subtitle: 'Registered address for invoices.', needs: 'business' },
  { key: 'venue', label: 'Venue details', title: 'Venue details', subtitle: 'Name, type, what you host and how customers book.', needs: 'business' },
  { key: 'location', label: 'Exact location', title: 'Exact location', subtitle: 'Customers navigate to this pin, so place it on your entrance.', needs: 'venue' },
  { key: 'spaces', label: 'Spaces', title: 'Spaces', subtitle: 'Each bookable area with capacity and slot prices.', needs: 'venue' },
  { key: 'facilities', label: 'Facilities', title: 'Facilities', subtitle: 'What guests get at your venue.', needs: 'venue' },
  { key: 'photos', label: 'Photos', title: 'Photos', subtitle: 'At least 3 clear photos. Categorise them so customers find what they need.', needs: 'venue' },
  { key: 'packages', label: 'Packages', title: 'Packages', subtitle: 'Bundles customers can pick at checkout.', needs: 'venue' },
  { key: 'pricing', label: 'Pricing & policy', title: 'Pricing review & cancellation policy', subtitle: 'Check your prices and set refund rules.', needs: 'venue' },
  { key: 'availability', label: 'Availability', title: 'Availability (optional)', subtitle: 'Already have bookings or closed dates? Block them now.', needs: 'venue' },
  { key: 'bank', label: 'Bank details', title: 'Bank & tax details', subtitle: 'Where we send your payouts.', needs: 'business' },
  { key: 'documents', label: 'Documents', title: 'Verification documents', subtitle: 'Helps us verify you quickly.', needs: 'business' },
  { key: 'submit', label: 'Submit', title: 'Submit for verification', subtitle: 'Our team reviews most applications within 2 working days.', needs: 'business' },
];

const TYPES = [
  { code: 'venue', label: 'Venue', desc: 'Banquet, lawn, farmhouse, hotel, party hall' },
  { code: 'catering', label: 'Catering', desc: 'Food & beverage for events' },
  { code: 'decoration', label: 'Decoration', desc: 'Décor, flowers, lighting' },
  { code: 'photography', label: 'Photography', desc: 'Photo & video coverage' },
  { code: 'other', label: 'Other', desc: 'DJ, invitations, planners…' },
];

export function Onboarding() {
  const { me, reloadMe, logout } = useBiz();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [venueLoading, setVenueLoading] = useState(false);
  const biz = me.business;
  const venueId = me.venues?.[0]?.id;

  const refreshVenue = useCallback(async () => {
    if (!venueId) return setVenue(null);
    setVenueLoading(true);
    try {
      setVenue(await loadVenue(venueId));
    } finally {
      setVenueLoading(false);
    }
  }, [venueId]);
  useEffect(() => {
    refreshVenue();
  }, [refreshVenue]);

  const done = useMemo(() => {
    const c = Object.fromEntries((me.checklist || []).map((x) => [x.key, x.done]));
    const zeroRule = venue?.cancellation_policy?.some((r) => r.min_days === 0);
    return {
      type: Boolean(biz),
      business: Boolean(c.business),
      owner: Boolean(biz?.owner_name && biz?.phone),
      address: Boolean(c.address),
      venue: Boolean(c.venue),
      location: Boolean(c.location),
      spaces: Boolean(c.spaces),
      facilities: Boolean(c.facilities),
      photos: Boolean(c.photos),
      packages: Boolean(c.packages),
      pricing: Boolean(c.spaces && zeroRule),
      availability: Boolean(c.spaces),
      bank: Boolean(c.bank),
      documents: Boolean(c.documents),
      submit: Boolean(biz && !needsOnboarding(me)),
    } as Record<StepKey, boolean>;
  }, [me, biz, venue]);

  const requested = params.get('step') as StepKey | null;
  const firstOpen = STEPS.find((s) => !done[s.key])?.key || 'submit';
  const current: StepKey = requested && STEPS.some((s) => s.key === requested) ? requested : biz ? firstOpen : 'type';
  const idx = STEPS.findIndex((s) => s.key === current);
  const step = STEPS[idx];
  const available = (s: (typeof STEPS)[number]) => !s.needs || (s.needs === 'business' ? Boolean(biz) : Boolean(biz && venueId));
  const go = (k: StepKey) => {
    setParams({ step: k });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const next = () => {
    const n = STEPS.slice(idx + 1).find(available);
    if (n) go(n.key);
  };
  const prev = () => {
    const p = [...STEPS.slice(0, idx)].reverse().find(available);
    if (p) go(p.key);
  };
  const completed = STEPS.filter((s) => s.key !== 'submit' && done[s.key]).length;
  const total = STEPS.length - 1;

  const afterBusiness = async () => {
    await reloadMe();
  };
  const afterVenue = async (v: VenueDetail) => {
    setVenue(v);
    await reloadMe();
  };
  const afterVenueChange = async () => {
    await Promise.all([refreshVenue(), reloadMe()]);
  };

  let body: ReactNode;
  if (!available(step)) {
    body = (
      <Banner tone="info" title={step.needs === 'venue' ? 'Add your venue details first' : 'Start with your business type'} action={<Button size="sm" onClick={() => go(step.needs === 'venue' && biz ? 'venue' : 'type')}>Go there</Button>} />
    );
  } else if (step.needs === 'venue' && (venueLoading || !venue)) {
    body = <Loading label="Loading your venue…" />;
  } else {
    switch (current) {
      case 'type':
        body = <TypeStep onCreated={async () => { await reloadMe(); go('business'); }} />;
        break;
      case 'business':
        body = <BusinessInfoForm business={biz!} onSaved={afterBusiness} />;
        break;
      case 'owner':
        body = <OwnerForm business={biz!} onSaved={afterBusiness} />;
        break;
      case 'address':
        body = <AddressForm business={biz!} onSaved={afterBusiness} />;
        break;
      case 'venue':
        body = <VenueDetailsForm key={venue?.id || 'new'} venue={venue} onSaved={afterVenue} submitLabel={venue ? 'Save venue details' : 'Create venue'} />;
        break;
      case 'location':
        body = <LocationEditor key={venue!.id} venue={venue!} onSaved={afterVenue} />;
        break;
      case 'spaces':
        body = <SpacesEditor venue={venue!} onChanged={afterVenueChange} />;
        break;
      case 'facilities':
        body = <FacilitiesForm key={venue!.id} venue={venue!} onSaved={afterVenue} />;
        break;
      case 'photos':
        body = <PhotosEditor venue={venue!} onChanged={afterVenueChange} />;
        break;
      case 'packages':
        body = <PackagesEditor venue={venue!} onChanged={afterVenueChange} />;
        break;
      case 'pricing':
        body = (
          <div className="stack">
            <PricingReview venue={venue!} />
            <hr className="divider" />
            <h3>Cancellation policy</h3>
            <CancellationPolicyEditor key={venue!.id} venue={venue!} onSaved={afterVenue} />
          </div>
        );
        break;
      case 'availability':
        body = (
          <div className="stack">
            <p>
              Your calendar opens after you finish onboarding. There you can add offline bookings you already have, block dates and schedule maintenance, so customers never book a slot that's taken.
            </p>
            <p className="muted">You can skip this step now and do it any time from <strong>Calendar</strong>.</p>
            {!needsOnboarding(me) && (
              <div>
                <Link className="btn btn-secondary btn-md" to="/business/calendar">
                  Open calendar
                </Link>
              </div>
            )}
          </div>
        );
        break;
      case 'bank':
        body = <BankForm business={biz!} onSaved={afterBusiness} />;
        break;
      case 'documents':
        body = <DocumentsStep documents={me.documents || []} onChanged={afterBusiness} />;
        break;
      case 'submit':
        body = <SubmitStep onSubmitted={async () => { await reloadMe(); navigate('/business/verification'); }} goTo={go} done={done} />;
        break;
    }
  }

  return (
    <div className="onboarding">
      <header className="topbar" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div className="row">
          <Wordmark size={22} />
          <span className="portal-tag portal-tag-dark">Business setup</span>
        </div>
        <div className="row">
          {biz && !needsOnboarding(me) && (
            <Link className="btn btn-ghost btn-sm" to="/business">
              Go to dashboard
            </Link>
          )}
          <IconButton label="Log out" onClick={() => { logout(); navigate('/business/login'); }}>
            {Icons.logout}
          </IconButton>
        </div>
      </header>
      <div className="content" style={{ margin: '0 auto' }}>
        {biz?.status === 'REJECTED' && (
          <div style={{ marginBottom: 16 }}>
            <Banner tone="danger" title="Your application needs changes">
              {biz.rejection_reason || 'Please review your details and resubmit.'}
            </Banner>
          </div>
        )}
        {biz && !needsOnboarding(me) && (
          <div style={{ marginBottom: 16 }}>
            <Banner tone="info" title={<>Application status: <StatusPill status={biz.status} /></>}>
              Your application is submitted. You can still edit most details here.
            </Banner>
          </div>
        )}
        <div className="wizard">
          <nav className="rail" aria-label="Setup steps">
            <div className="row-between" style={{ padding: '0 4px' }}>
              <strong>Setup progress</strong>
              <span className="muted small">
                {completed}/{total}
              </span>
            </div>
            <div className="rail-progress">
              <span style={{ width: `${(completed / total) * 100}%` }} />
            </div>
            <div className="rail-steps">
              {STEPS.map((s, i) => (
                <button key={s.key} type="button" className={`rail-step ${s.key === current ? 'is-active' : ''} ${done[s.key] ? 'is-done' : ''}`} onClick={() => go(s.key)} disabled={!available(s) && s.key !== current} aria-current={s.key === current ? 'step' : undefined} style={!available(s) ? { opacity: 0.45 } : undefined}>
                  <span className="rail-num">{done[s.key] ? '✓' : i + 1}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </nav>
          <div>
            <Card title={step.title} subtitle={step.subtitle}>
              {body}
            </Card>
            <div className="wizard-foot">
              <Button variant="ghost" icon={Icons.chevronLeft} onClick={prev} disabled={idx === 0 || !biz}>
                Back
              </Button>
              {current !== 'submit' && (
                <Button variant="secondary" onClick={next} disabled={!biz}>
                  {done[current] || current === 'availability' ? 'Next step' : 'Skip for now'} →
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TypeStep({ onCreated }: { onCreated: () => void }) {
  const { me } = useBiz();
  const [type, setType] = useState('venue');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notYet, setNotYet] = useState<string | null>(null);
  const toast = useToast();
  if (me.business) {
    return (
      <div className="stack">
        <Banner tone="success" title="You're listing a venue">
          {me.business.name} · created on Pandal. Continue with your business information.
        </Banner>
      </div>
    );
  }
  const submit = async () => {
    if (!name.trim()) return setError('Enter your business name');
    setPending(true);
    setError(null);
    setNotYet(null);
    try {
      await bizApi.post('/business', { type, name: name.trim(), owner_name: me.user.name, phone: me.user.phone, email: me.user.email });
      toast('Business created');
      onCreated();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NOT_YET') setNotYet(e.message);
      else setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="stack">
      <div className="type-grid">
        {TYPES.map((t) => (
          <button key={t.code} type="button" className={`type-card ${type === t.code ? 'is-active' : ''}`} onClick={() => (setType(t.code), setNotYet(null))} aria-pressed={type === t.code}>
            <strong>{t.label}</strong>
            <span>{t.desc}</span>
            {t.code !== 'venue' && <span className="soon">Coming soon</span>}
          </button>
        ))}
      </div>
      {type !== 'venue' && !notYet && (
        <Banner tone="info" title="We're onboarding venues first">
          {TYPES.find((t) => t.code === type)?.label} partners open soon. Leave your business name and we'll note your interest.
        </Banner>
      )}
      <Field label="Business name" required>
        <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={type === 'venue' ? 'e.g. Royal Garden Banquet' : 'Your business name'} />
      </Field>
      {notYet && (
        <Banner tone="warning" title="Coming soon, thank you!">
          {notYet}
        </Banner>
      )}
      <InlineError message={error} />
      <div>
        <Button onClick={submit} pending={pending} size="lg">
          {type === 'venue' ? 'Start listing my venue' : 'Register my interest'}
        </Button>
      </div>
    </div>
  );
}

function SubmitStep({ onSubmitted, goTo, done }: { onSubmitted: () => void; goTo: (k: StepKey) => void; done: Record<StepKey, boolean> }) {
  const { me } = useBiz();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const toast = useToast();
  const status = me.business?.status;
  const canSubmit = status === 'DRAFT' || status === 'REJECTED';
  const submit = async () => {
    setPending(true);
    setError(null);
    setMissing([]);
    try {
      await bizApi.post('/business/submit');
      toast('Submitted for verification');
      onSubmitted();
    } catch (e) {
      const m = e instanceof ApiError ? (e.details as { missing?: string[] } | null)?.missing : null;
      if (m?.length) setMissing(m);
      else setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  const keys: StepKey[] = ['business', 'owner', 'address', 'venue', 'location', 'spaces', 'facilities', 'photos', 'packages', 'pricing', 'bank', 'documents'];
  return (
    <div className="stack">
      <div className="stack-sm">
        {keys.map((k) => {
          const s = STEPS.find((x) => x.key === k)!;
          return (
            <div key={k} className="row-between" style={{ padding: '6px 0', borderBottom: '1px dashed var(--border)' }}>
              <span className="row">
                <span style={{ color: done[k] ? 'var(--success)' : 'var(--warning)' }}>{done[k] ? Icons.check : '•'}</span>
                {s.title}
              </span>
              {!done[k] && (
                <button type="button" className="link-btn" onClick={() => goTo(k)}>
                  Complete
                </button>
              )}
            </div>
          );
        })}
      </div>
      {missing.length > 0 && (
        <Banner tone="danger" title="Almost there. Please complete these first:">
          <ul className="missing-list">
            {missing.map((m) => (
              <li key={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</li>
            ))}
          </ul>
        </Banner>
      )}
      <InlineError message={error} />
      <p className="muted">By submitting you confirm the details are accurate and that you're authorised to list this venue.</p>
      <div>
        <Button size="lg" variant="accent" onClick={submit} pending={pending} disabled={!canSubmit}>
          {canSubmit ? 'Submit for verification' : `Already ${status?.toLowerCase().replace('_', ' ')}`}
        </Button>
      </div>
    </div>
  );
}
