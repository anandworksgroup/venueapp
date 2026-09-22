// Venue editing building blocks shared by the onboarding wizard and the Venue page.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { bizApi, errMsg, fileToBase64, publicApi } from '../../api';
import { useMeta } from '../../shared/hooks';
import { MapPicker } from '../../shared/MapPicker';
import { Icons } from '../../shared/icons';
import { mediaUrl, money, titleCase } from '../../shared/format';
import { Banner, Button, Checkbox, ConfirmDialog, EmptyState, Field, IconButton, InlineError, Input, Modal, NumberInput, Pill, Segmented, Select, Table, Textarea, useToast } from '../../ui';
import type { CancellationRule, Inclusion, PackageRow, SpaceRow, VenueDetail } from '../../types';

export type OnVenue = (v: VenueDetail) => void;

/** Save helper with pending + error state. */
function useSaver() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const save = useCallback(
    async <T,>(fn: () => Promise<T>, okMsg = 'Saved'): Promise<T | undefined> => {
      setPending(true);
      setError(null);
      try {
        const r = await fn();
        if (okMsg) toast(okMsg);
        return r;
      } catch (e) {
        setError(errMsg(e));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [toast],
  );
  return { pending, error, save, setError };
}

export const loadVenue = (id: string) => bizApi.get<VenueDetail>(`/business/venues/${id}`);

// ─────────────────────────────── Venue details ───────────────────────────────

export function VenueDetailsForm({ venue, onSaved, submitLabel = 'Save venue details' }: { venue: VenueDetail | null; onSaved: OnVenue; submitLabel?: string }) {
  const meta = useMeta();
  const [f, setF] = useState(() => ({
    name: venue?.name || '',
    venue_type: venue?.venue_type || '',
    description: venue?.description || '',
    event_types: venue?.event_types || [],
    booking_mode: venue?.booking_mode || 'instant',
    advance_pct: venue?.advance_pct ?? 20,
  }));
  const { pending, error, save, setError } = useSaver();
  const submit = async () => {
    if (!f.name.trim() || !f.venue_type) return setError('Venue name and type are required');
    if (!f.event_types.length) return setError('Pick at least one event type you host');
    const body = { ...f, advance_pct: Number(f.advance_pct) || 20 };
    const r = await save(async () => {
      const saved = venue ? await bizApi.put<VenueDetail>(`/business/venues/${venue.id}`, body) : await bizApi.post<VenueDetail>('/business/venues', body);
      return loadVenue(saved.id);
    }, venue ? 'Venue details saved' : 'Venue created');
    if (r) onSaved(r);
  };
  const toggleEvent = (code: string) => setF((x) => ({ ...x, event_types: x.event_types.includes(code) ? x.event_types.filter((c) => c !== code) : [...x.event_types, code] }));
  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="Venue name" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} placeholder="e.g. Royal Garden Banquet" />
        </Field>
        <Field label="Venue type" required>
          <Select value={f.venue_type} onChange={(e) => setF({ ...f, venue_type: e.target.value })} placeholder="Choose a type" options={(meta.data?.venue_types || []).map((t) => ({ value: t.code, label: t.name }))} />
        </Field>
        <Field label="Description" className="span-2" hint="What makes it special: the spaces, food, décor, parking, nearby landmarks.">
          <Textarea rows={4} value={f.description} maxLength={4000} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
      <Field label="Event types you host" required>
        <div className="check-grid">
          {(meta.data?.event_categories || []).map((c) => (
            <Checkbox key={c.code} label={c.name} checked={f.event_types.includes(c.code)} onChange={() => toggleEvent(c.code)} />
          ))}
        </div>
      </Field>
      <div className="form-grid">
        <Field label="Booking mode" hint={f.booking_mode === 'instant' ? 'Customers book and pay right away (recommended).' : 'Customers send a request; you accept before they pay.'}>
          <Segmented
            value={f.booking_mode}
            onChange={(v) => setF({ ...f, booking_mode: v })}
            options={[
              { value: 'instant', label: 'Instant booking' },
              { value: 'request', label: 'Request to book' },
            ]}
          />
        </Field>
        <Field label="Advance to confirm a booking (%)" hint="5–100%. The balance is paid before the event.">
          <NumberInput min={5} max={100} value={f.advance_pct} onChange={(v) => setF({ ...f, advance_pct: v === '' ? 20 : v })} />
        </Field>
      </div>
      <InlineError message={error} />
      <div>
        <Button onClick={submit} pending={pending}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────── Location ───────────────────────────────

interface PlaceHit {
  type: string;
  id: string;
  label: string;
  area?: string;
  city?: string;
  state?: string;
  pincode?: string;
  lat: number;
  lng: number;
}

export function LocationEditor({ venue, onSaved }: { venue: VenueDetail; onSaved: OnVenue }) {
  const [lat, setLat] = useState<number | null>(venue.lat);
  const [lng, setLng] = useState<number | null>(venue.lng);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [f, setF] = useState({ address: venue.address || '', area: venue.area || '', city: venue.city || '', state: venue.state || '', pincode: venue.pincode || '' });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const { pending, error, save, setError } = useSaver();

  const search = async () => {
    if (q.trim().length < 2) return;
    setSearching(true);
    try {
      const r = await publicApi.get<{ items: PlaceHit[] }>('/locations/search', { q: q.trim() });
      setHits(r.items.filter((h, i, a) => a.findIndex((x) => x.label === h.label) === i).slice(0, 6));
      if (!r.items.length) setError('No matching area, city or pincode. Drag the pin manually.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSearching(false);
    }
  };
  const pick = (h: PlaceHit) => {
    setLat(h.lat);
    setLng(h.lng);
    setFocus([h.lat, h.lng]);
    setHits([]);
    setF((x) => ({ ...x, area: h.area || x.area, city: h.city || x.city, state: h.state || x.state, pincode: h.pincode || x.pincode }));
  };
  const onMove = useCallback((a: number, b: number) => {
    setLat(Math.round(a * 1e6) / 1e6);
    setLng(Math.round(b * 1e6) / 1e6);
  }, []);
  const locate = () => {
    if (!navigator.geolocation) return setError('Your browser cannot share location');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onMove(p.coords.latitude, p.coords.longitude);
        setFocus([p.coords.latitude, p.coords.longitude]);
      },
      () => setError('Location permission denied. Search or drag the pin instead.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  const submit = async () => {
    if (lat == null || lng == null) return setError('Drag the pin (or tap the map) onto your venue entrance first');
    if (!f.address.trim()) return setError('Full address is required');
    if (!/^\d{6}$/.test(f.pincode)) return setError('Pincode must be 6 digits');
    const r = await save(async () => {
      const res = await bizApi.put<{ warnings: string[]; location_verified: boolean; area: string | null }>(`/business/venues/${venue.id}/location`, { lat, lng, ...f });
      setWarnings(res.warnings || []);
      return loadVenue(venue.id);
    }, 'Location saved');
    if (r) onSaved(r);
  };
  return (
    <div className="stack">
      <div className="row">
        <div className="search-input">
          {Icons.search}
          <Input value={q} placeholder="Search area, city or pincode to jump the map" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), search())} />
        </div>
        <Button variant="secondary" onClick={search} pending={searching}>
          Search
        </Button>
        <Button variant="ghost" onClick={locate} icon={Icons.pin}>
          Use my location
        </Button>
      </div>
      {hits.length > 0 && (
        <div className="chips">
          {hits.map((h) => (
            <button key={`${h.type}-${h.id}`} type="button" className="chip" onClick={() => pick(h)}>
              {h.label}
            </button>
          ))}
        </div>
      )}
      <div>
        <div className="map-caption">
          {Icons.pin} Move the pin to your exact venue entrance
        </div>
        <MapPicker lat={lat} lng={lng} onChange={onMove} focus={focus} />
        <p className="muted small" style={{ marginTop: 6 }}>
          Drag the pin or tap the map. {lat != null && lng != null ? `Pin: ${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'No pin placed yet.'}
          {venue.location_verified ? ' · Location verified by Pandal (moving the pin resets verification).' : ''}
        </p>
      </div>
      {warnings.length > 0 && (
        <Banner tone="warning" title="Please double-check your pin">
          <ul className="missing-list">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Banner>
      )}
      <div className="form-grid">
        <Field label="Full address" required className="span-2">
          <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={300} placeholder="Building, street, landmark" />
        </Field>
        <Field label="Area / locality">
          <Input value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} maxLength={80} />
        </Field>
        <Field label="City">
          <Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} maxLength={80} />
        </Field>
        <Field label="State">
          <Input value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Pincode" required>
          <Input value={f.pincode} inputMode="numeric" maxLength={6} onChange={(e) => setF({ ...f, pincode: e.target.value.replace(/\D/g, '') })} />
        </Field>
      </div>
      <InlineError message={error} />
      <div>
        <Button onClick={submit} pending={pending}>
          Save location
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────── Spaces ───────────────────────────────

const SPACE_KINDS = ['indoor', 'outdoor', 'dining', 'rooftop', 'poolside'];
type SpaceForm = {
  name: string;
  kind: string;
  capacity_seated: number | '';
  capacity_floating: number | '';
  min_guests: number | '';
  price_morning: number | '';
  price_evening: number | '';
  price_full_day: number | '';
  weekend_surcharge_pct: number | '';
  description: string;
  facilities: string[];
};
const blankSpace: SpaceForm = { name: '', kind: 'indoor', capacity_seated: '', capacity_floating: '', min_guests: 0, price_morning: '', price_evening: '', price_full_day: '', weekend_surcharge_pct: 0, description: '', facilities: [] };

function SpaceEditorModal({ venueId, space, open, onClose, onDone }: { venueId: string; space: SpaceRow | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<SpaceForm>(blankSpace);
  const { pending, error, save, setError } = useSaver();
  useEffect(() => {
    if (open) {
      setError(null);
      setF(
        space
          ? { name: space.name, kind: space.kind, capacity_seated: space.capacity_seated, capacity_floating: space.capacity_floating, min_guests: space.min_guests, price_morning: space.price_morning, price_evening: space.price_evening, price_full_day: space.price_full_day, weekend_surcharge_pct: space.weekend_surcharge_pct, description: space.description || '', facilities: space.facilities || [] }
          : blankSpace,
      );
    }
  }, [open, space, setError]);
  const submit = async () => {
    const n = (v: number | '') => (v === '' ? null : v);
    if (!f.name.trim()) return setError('Space name is required');
    const body = { ...f, capacity_seated: n(f.capacity_seated), capacity_floating: n(f.capacity_floating) ?? n(f.capacity_seated), min_guests: n(f.min_guests) ?? 0, price_morning: n(f.price_morning), price_evening: n(f.price_evening), price_full_day: n(f.price_full_day), weekend_surcharge_pct: n(f.weekend_surcharge_pct) ?? 0 };
    // Backend quirk: PUT merges the stored row, whose `active` is 0/1, and treats anything but `false` as active; send it explicitly.
    const r = await save(() => (space ? bizApi.put(`/business/venues/${venueId}/spaces/${space.id}`, { ...body, active: Boolean(space.active) }) : bizApi.post(`/business/venues/${venueId}/spaces`, body)), space ? 'Space updated' : 'Space added');
    if (r) {
      onDone();
      onClose();
    }
  };
  const num = (k: keyof SpaceForm) => (v: number | '') => setF({ ...f, [k]: v });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={space ? `Edit ${space.name}` : 'Add a space'}
      width={680}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} pending={pending}>
            {space ? 'Save space' : 'Add space'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Space name" required>
            <Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Grand Hall" />
          </Field>
          <Field label="Kind">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={SPACE_KINDS.map((k) => ({ value: k, label: titleCase(k) }))} />
          </Field>
        </div>
        <div className="form-grid-3">
          <Field label="Seated capacity" required>
            <NumberInput min={1} value={f.capacity_seated} onChange={num('capacity_seated')} />
          </Field>
          <Field label="Floating capacity" hint="Standing / cocktail">
            <NumberInput min={1} value={f.capacity_floating} onChange={num('capacity_floating')} />
          </Field>
          <Field label="Minimum guests">
            <NumberInput min={0} value={f.min_guests} onChange={num('min_guests')} />
          </Field>
        </div>
        <div className="form-grid-3">
          <Field label="Morning price" hint="08:00–14:00" required>
            <NumberInput prefix="₹" min={0} value={f.price_morning} onChange={num('price_morning')} />
          </Field>
          <Field label="Evening price" hint="17:00–23:00" required>
            <NumberInput prefix="₹" min={0} value={f.price_evening} onChange={num('price_evening')} />
          </Field>
          <Field label="Full-day price" hint="At least the higher slot" required>
            <NumberInput prefix="₹" min={0} value={f.price_full_day} onChange={num('price_full_day')} />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Weekend surcharge (%)" hint="Added on Saturdays and Sundays">
            <NumberInput min={0} max={200} value={f.weekend_surcharge_pct} onChange={num('weekend_surcharge_pct')} />
          </Field>
          <Field label="Short description">
            <Input value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </div>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

export function SpacesEditor({ venue, onChanged }: { venue: VenueDetail; onChanged: () => void }) {
  const [editing, setEditing] = useState<SpaceRow | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const spaces = venue.all_spaces || [];
  const toggle = async (s: SpaceRow) => {
    setBusy(s.id);
    setError(null);
    try {
      await bizApi.put(`/business/venues/${venue.id}/spaces/${s.id}`, { active: !s.active });
      toast(s.active ? `${s.name} deactivated` : `${s.name} is active again`);
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="stack">
      {spaces.length === 0 ? (
        <EmptyState title="No spaces yet" body="Add each bookable area (hall, lawn, terrace) with its capacity and slot prices." />
      ) : (
        <Table
          rows={spaces}
          rowKey={(s) => s.id}
          rowClassName={(s) => (s.active ? undefined : 'row-muted')}
          columns={[
            { key: 'name', header: 'Space', render: (s) => (<><div className="cell-main">{s.name}</div><div className="cell-sub">{titleCase(s.kind)}{s.active ? '' : ' · inactive'}</div></>) },
            { key: 'cap', header: 'Capacity', render: (s) => `${s.capacity_seated} seated / ${s.capacity_floating} floating` },
            { key: 'am', header: 'Morning', align: 'right', render: (s) => money(s.price_morning) },
            { key: 'pm', header: 'Evening', align: 'right', render: (s) => money(s.price_evening) },
            { key: 'fd', header: 'Full day', align: 'right', render: (s) => money(s.price_full_day) },
            { key: 'wk', header: 'Weekend', align: 'right', render: (s) => (s.weekend_surcharge_pct ? `+${s.weekend_surcharge_pct}%` : '—') },
            {
              key: 'act',
              header: '',
              align: 'right',
              render: (s) => (
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="secondary" onClick={() => (setEditing(s), setOpen(true))}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" pending={busy === s.id} onClick={() => toggle(s)}>
                    {s.active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
      <InlineError message={error} />
      <div>
        <Button icon={Icons.plus} variant="secondary" onClick={() => (setEditing(null), setOpen(true))}>
          Add space
        </Button>
      </div>
      <SpaceEditorModal venueId={venue.id} space={editing} open={open} onClose={() => setOpen(false)} onDone={onChanged} />
    </div>
  );
}

// ─────────────────────────────── Facilities ───────────────────────────────

export function FacilitiesForm({ venue, onSaved }: { venue: VenueDetail; onSaved: OnVenue }) {
  const meta = useMeta();
  const [fac, setFac] = useState<string[]>(venue.facilities || []);
  const [parking, setParking] = useState<number | ''>(venue.capacity?.parking_cars ?? 0);
  const [rooms, setRooms] = useState<number | ''>(venue.capacity?.rooms ?? 0);
  const { pending, error, save } = useSaver();
  const submit = async () => {
    const r = await save(async () => {
      await bizApi.put(`/business/venues/${venue.id}`, { facilities: fac, parking_cars: parking || 0, rooms: rooms || 0 });
      return loadVenue(venue.id);
    }, 'Facilities saved');
    if (r) onSaved(r);
  };
  return (
    <div className="stack">
      <div className="check-grid">
        {(meta.data?.facilities || []).map((x) => (
          <Checkbox key={x.code} label={x.name} checked={fac.includes(x.code)} onChange={(on) => setFac(on ? [...fac, x.code] : fac.filter((c) => c !== x.code))} />
        ))}
      </div>
      <div className="form-grid">
        <Field label="Parking capacity (cars)">
          <NumberInput min={0} max={5000} value={parking} onChange={setParking} />
        </Field>
        <Field label="Rooms for guests">
          <NumberInput min={0} max={1000} value={rooms} onChange={setRooms} />
        </Field>
      </div>
      <InlineError message={error} />
      <div>
        <Button onClick={submit} pending={pending}>
          Save facilities
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────── Photos ───────────────────────────────

export function PhotosEditor({ venue, onChanged }: { venue: VenueDetail; onChanged: () => void }) {
  const meta = useMeta();
  const [category, setCategory] = useState('exterior');
  const [spaceId, setSpaceId] = useState('');
  const [caption, setCaption] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const toast = useToast();
  const photos = venue.gallery.filter((g) => g.media_type === 'photo');
  const upload = async () => {
    if (!files.length) return setError('Choose one or more photos first');
    const tooBig = files.find((f) => f.size > 6 * 1024 * 1024);
    if (tooBig) return setError(`${tooBig.name} is larger than 6 MB. Please resize it.`);
    const bad = files.find((f) => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type));
    if (bad) return setError(`${bad.name}: only JPG, PNG or WebP photos`);
    setPending(true);
    setError(null);
    let done = 0;
    try {
      for (const file of files) {
        setProgress(`Uploading ${done + 1} of ${files.length}…`);
        const data_base64 = await fileToBase64(file);
        await bizApi.post(`/business/venues/${venue.id}/images`, { category, mime: file.type, data_base64, space_id: spaceId || undefined, caption: caption || undefined });
        done++;
      }
      toast(`${done} photo${done > 1 ? 's' : ''} uploaded`);
      setFiles([]);
      setCaption('');
      setInputKey((k) => k + 1);
    } catch (e) {
      setError(`${done} uploaded. ${errMsg(e)}`);
    } finally {
      setPending(false);
      setProgress('');
      onChanged();
    }
  };
  const remove = async (id: string) => {
    await bizApi.del(`/business/venues/${venue.id}/images/${id}`);
    toast('Photo removed');
    onChanged();
  };
  return (
    <div className="stack">
      <div className="dropzone">
        <Field label="Photos (JPG/PNG/WebP, max 6 MB each)">
          <input key={inputKey} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} options={(meta.data?.image_categories || []).map((c) => ({ value: c, label: titleCase(c) }))} />
        </Field>
        <Field label="Space (optional)">
          <Select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} placeholder="Whole venue" options={(venue.all_spaces || []).map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Caption (optional)">
          <Input value={caption} maxLength={120} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <Button icon={Icons.upload} onClick={upload} pending={pending}>
          {progress || 'Upload'}
        </Button>
      </div>
      <InlineError message={error} />
      <div className="row-between">
        <strong>{photos.length} photo{photos.length === 1 ? '' : 's'}</strong>
        {photos.length < 3 && <Pill tone="warning">Add at least 3 photos</Pill>}
      </div>
      {photos.length === 0 ? (
        <EmptyState title="No photos yet" body="Great photos get more bookings: entrance, main hall, lawn, stage, dining and parking." />
      ) : (
        <div className="photo-grid">
          {photos.map((p) => (
            <div key={p.id} className="photo">
              <img src={mediaUrl(p.url)} alt={p.caption || p.category} loading="lazy" />
              <div className="photo-meta">
                <span>{titleCase(p.category)}</span>
              </div>
              <IconButton label="Delete photo" className="photo-del" onClick={() => setDel(p.id)}>
                {Icons.trash}
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Delete this photo?" message="It will be removed from your listing right away." confirmLabel="Delete photo" danger onConfirm={() => del && remove(del)} />
    </div>
  );
}

// ─────────────────────────────── Packages ───────────────────────────────

const INCLUSION_CODES = ['venue', 'catering', 'decoration', 'furniture', 'sound', 'lighting', 'parking', 'dj', 'photography', 'rooms', 'other'];
const TIERS = ['essential', 'premium', 'luxury', 'custom'];
type PkgForm = { name: string; tier: string; pricing_mode: PackageRow['pricing_mode']; price: number | ''; min_guests: number | ''; inclusions: Inclusion[]; description: string };
const blankPkg: PkgForm = { name: '', tier: 'essential', pricing_mode: 'per_plate', price: '', min_guests: 0, inclusions: [{ code: 'venue', label: 'Venue rental' }], description: '' };

function PackageModal({ venueId, pkg, open, onClose, onDone }: { venueId: string; pkg: PackageRow | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<PkgForm>(blankPkg);
  const { pending, error, save, setError } = useSaver();
  useEffect(() => {
    if (open) {
      setError(null);
      setF(pkg ? { name: pkg.name, tier: pkg.tier, pricing_mode: pkg.pricing_mode, price: pkg.price, min_guests: pkg.min_guests, inclusions: pkg.inclusions.length ? pkg.inclusions : [], description: pkg.description || '' } : blankPkg);
    }
  }, [open, pkg, setError]);
  const setInc = (i: number, patch: Partial<Inclusion>) => setF({ ...f, inclusions: f.inclusions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const submit = async () => {
    if (!f.name.trim()) return setError('Package name is required');
    if (f.pricing_mode !== 'included' && !f.price) return setError('Enter a price');
    const body = { ...f, price: f.pricing_mode === 'included' ? 0 : f.price, min_guests: f.min_guests || 0, inclusions: f.inclusions.filter((i) => i.label.trim()) };
    const r = await save(() => (pkg ? bizApi.put(`/business/venues/${venueId}/packages/${pkg.id}`, { ...body, active: Boolean(pkg.active) }) : bizApi.post(`/business/venues/${venueId}/packages`, body)), pkg ? 'Package updated' : 'Package added');
    if (r) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={pkg ? `Edit ${pkg.name}` : 'Add a package'}
      width={680}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} pending={pending}>
            {pkg ? 'Save package' : 'Add package'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Package name" required>
            <Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Premium Wedding" />
          </Field>
          <Field label="Tier">
            <Select value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })} options={TIERS.map((t) => ({ value: t, label: titleCase(t) }))} />
          </Field>
        </div>
        <Field label="Pricing">
          <Segmented
            value={f.pricing_mode}
            onChange={(v) => setF({ ...f, pricing_mode: v })}
            options={[
              { value: 'included', label: 'Included in venue rent' },
              { value: 'flat', label: 'Flat price' },
              { value: 'per_plate', label: 'Per plate' },
            ]}
          />
        </Field>
        <div className="form-grid">
          {f.pricing_mode !== 'included' && (
            <Field label={f.pricing_mode === 'per_plate' ? 'Price per plate' : 'Package price'} required>
              <NumberInput prefix="₹" min={1} value={f.price} onChange={(v) => setF({ ...f, price: v })} />
            </Field>
          )}
          <Field label="Minimum guests">
            <NumberInput min={0} value={f.min_guests} onChange={(v) => setF({ ...f, min_guests: v })} />
          </Field>
        </div>
        <Field label="What's included">
          <div className="stack-sm">
            {f.inclusions.map((inc, i) => (
              <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                <Select style={{ maxWidth: 160 }} value={inc.code} onChange={(e) => setInc(i, { code: e.target.value })} options={INCLUSION_CODES.map((c) => ({ value: c, label: titleCase(c) }))} />
                <Input value={inc.label} maxLength={120} placeholder="e.g. 3 starters, 2 mains, dessert" onChange={(e) => setInc(i, { label: e.target.value })} />
                <IconButton label="Remove inclusion" onClick={() => setF({ ...f, inclusions: f.inclusions.filter((_, j) => j !== i) })}>
                  ✕
                </IconButton>
              </div>
            ))}
            <div>
              <Button size="sm" variant="ghost" icon={Icons.plus} onClick={() => setF({ ...f, inclusions: [...f.inclusions, { code: 'catering', label: '' }] })} disabled={f.inclusions.length >= 20}>
                Add inclusion
              </Button>
            </div>
          </div>
        </Field>
        <Field label="Description">
          <Textarea value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

export function PackagesEditor({ venue, onChanged }: { venue: VenueDetail; onChanged: () => void }) {
  const [editing, setEditing] = useState<PackageRow | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pkgs = venue.all_packages || [];
  const toggle = async (p: PackageRow) => {
    setBusy(p.id);
    setError(null);
    try {
      await bizApi.put(`/business/venues/${venue.id}/packages/${p.id}`, { active: !p.active });
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  const priceText = (p: PackageRow) => (p.pricing_mode === 'included' ? 'Included' : p.pricing_mode === 'per_plate' ? `${money(p.price)} / plate` : money(p.price));
  return (
    <div className="stack">
      {pkgs.length === 0 ? (
        <EmptyState title="No packages yet" body="Packages help customers compare: e.g. Essential (venue only), Premium (with catering and décor)." />
      ) : (
        pkgs.map((p) => (
          <div key={p.id} className={`editor-row ${p.active ? '' : 'inactive'}`}>
            <div className="row-between">
              <div>
                <div className="row">
                  <strong>{p.name}</strong>
                  <Pill tone="teal">{titleCase(p.tier)}</Pill>
                  {!p.active && <Pill>Inactive</Pill>}
                </div>
                <div className="muted small">
                  {priceText(p)}
                  {p.min_guests ? ` · min ${p.min_guests} guests` : ''}
                </div>
              </div>
              <div className="row">
                <Button size="sm" variant="secondary" onClick={() => (setEditing(p), setOpen(true))}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" pending={busy === p.id} onClick={() => toggle(p)}>
                  {p.active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </div>
            {p.inclusions.length > 0 && (
              <div className="chips" style={{ marginTop: 10 }}>
                {p.inclusions.map((i, k) => (
                  <Pill key={k}>
                    {titleCase(i.code)}: {i.label}
                  </Pill>
                ))}
              </div>
            )}
          </div>
        ))
      )}
      <InlineError message={error} />
      <div>
        <Button icon={Icons.plus} variant="secondary" onClick={() => (setEditing(null), setOpen(true))}>
          Add package
        </Button>
      </div>
      <PackageModal venueId={venue.id} pkg={editing} open={open} onClose={() => setOpen(false)} onDone={onChanged} />
    </div>
  );
}

// ─────────────────────────────── Pricing review & cancellation policy ───────────────────────────────

export function PricingReview({ venue }: { venue: VenueDetail }) {
  const spaces = (venue.all_spaces || []).filter((s) => s.active);
  if (!spaces.length) return <EmptyState title="No active spaces" body="Add a space with prices first." />;
  return (
    <Table
      rows={spaces}
      rowKey={(s) => s.id}
      columns={[
        { key: 'n', header: 'Space', render: (s) => <span className="cell-main">{s.name}</span> },
        { key: 'm', header: 'Morning', align: 'right', render: (s) => money(s.price_morning) },
        { key: 'e', header: 'Evening', align: 'right', render: (s) => money(s.price_evening) },
        { key: 'f', header: 'Full day', align: 'right', render: (s) => money(s.price_full_day) },
        {
          key: 'w',
          header: 'Weekend (Evening)',
          align: 'right',
          render: (s) => (s.weekend_surcharge_pct ? money(Math.round(s.price_evening * (1 + s.weekend_surcharge_pct / 100))) : <span className="muted">same</span>),
        },
      ]}
    />
  );
}

export function CancellationPolicyEditor({ venue, onSaved }: { venue: VenueDetail; onSaved: OnVenue }) {
  const [rows, setRows] = useState<CancellationRule[]>(() => (venue.cancellation_policy?.length ? venue.cancellation_policy.map((r) => ({ ...r })) : [{ min_days: 0, refund_pct: 0, label: 'Less than 7 days' }]));
  const { pending, error, save, setError } = useSaver();
  const hasZero = useMemo(() => rows.some((r) => Number(r.min_days) === 0), [rows]);
  const setRow = (i: number, patch: Partial<CancellationRule>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const submit = async () => {
    if (!hasZero) return setError('Add a rule for 0 days (cancellations close to the event)');
    const r = await save(async () => {
      await bizApi.put(`/business/venues/${venue.id}`, { cancellation_policy: rows.map((x) => ({ ...x, min_days: Number(x.min_days) || 0, refund_pct: Number(x.refund_pct) || 0 })) });
      return loadVenue(venue.id);
    }, 'Cancellation policy saved');
    if (r) {
      setRows(r.cancellation_policy.map((x) => ({ ...x })));
      onSaved(r);
    }
  };
  return (
    <div className="stack">
      <p className="muted">When a customer cancels, they get this share of what they paid back. If you cancel, the customer always gets a full refund.</p>
      <div className="stack-sm">
        {rows.map((r, i) => (
          <div key={i} className="row" style={{ flexWrap: 'nowrap', alignItems: 'end' }}>
            <Field label={i === 0 ? 'Days before event (≥)' : ''}>
              <NumberInput min={0} max={730} value={r.min_days} onChange={(v) => setRow(i, { min_days: v === '' ? 0 : v })} />
            </Field>
            <Field label={i === 0 ? 'Refund %' : ''}>
              <NumberInput min={0} max={100} value={r.refund_pct} onChange={(v) => setRow(i, { refund_pct: v === '' ? 0 : v })} />
            </Field>
            <Field label={i === 0 ? 'Label shown to customers' : ''} className="grow">
              <Input value={r.label} maxLength={60} onChange={(e) => setRow(i, { label: e.target.value })} />
            </Field>
            <IconButton label="Remove rule" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length <= 1}>
              ✕
            </IconButton>
          </div>
        ))}
      </div>
      {!hasZero && <Banner tone="warning">Your policy must include a 0-day rule, for cancellations close to the event.</Banner>}
      <div className="row">
        <Button size="sm" variant="ghost" icon={Icons.plus} onClick={() => setRows([...rows, { min_days: 0, refund_pct: 0, label: '' }])}>
          Add rule
        </Button>
      </div>
      <InlineError message={error} />
      <div>
        <Button onClick={submit} pending={pending}>
          Save policy
        </Button>
      </div>
    </div>
  );
}
