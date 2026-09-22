import { useEffect, useState } from 'react';
import { ApiError, bizApi, errMsg } from '../api';
import { todayIst, titleCase } from '../shared/format';
import { useMeta } from '../shared/hooks';
import { Banner, Button, Field, InlineError, Input, Modal, NumberInput, Segmented, Select, Textarea, useToast } from '../ui';
import type { BookingFull, Slot, SpaceRow } from '../types';
import { useBiz } from './context';
import { loadVenue } from './steps/VenueForms';

export interface InventoryDefaults {
  venueId?: string;
  date?: string;
  spaceId?: string;
  slot?: Slot;
}

const SLOT_OPTIONS: { value: Slot; label: string }[] = [
  { value: 'MORNING', label: 'Morning · 8 AM–2 PM' },
  { value: 'EVENING', label: 'Evening · 5–11 PM' },
  { value: 'FULL_DAY', label: 'Full day' },
];

function useVenueSpaces(venueId: string | undefined, open: boolean) {
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !venueId) return;
    let alive = true;
    setLoading(true);
    loadVenue(venueId)
      .then((v) => alive && setSpaces((v.all_spaces || []).filter((s) => s.active)))
      .catch(() => alive && setSpaces([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [venueId, open]);
  return { spaces, loading };
}

function VenueSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { me } = useBiz();
  const venues = me.venues || [];
  if (venues.length <= 1) return null;
  return (
    <Field label="Venue">
      <Select value={value} onChange={(e) => onChange(e.target.value)} options={venues.map((v) => ({ value: v.id, label: v.name }))} />
    </Field>
  );
}

export function OfflineBookingModal({ open, onClose, onDone, defaults }: { open: boolean; onClose: () => void; onDone?: (b: BookingFull) => void; defaults?: InventoryDefaults }) {
  const { me } = useBiz();
  const meta = useMeta();
  const toast = useToast();
  const [venueId, setVenueId] = useState('');
  const [f, setF] = useState({ customer_name: '', customer_phone: '', date: '', space_id: '', slot: 'EVENING' as Slot, source_channel: 'phone', event_type: 'wedding', guests: '' as number | '', amount: '' as number | '', notes: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const { spaces, loading } = useVenueSpaces(venueId, open);

  useEffect(() => {
    if (!open) return;
    setVenueId(defaults?.venueId || me.venues?.[0]?.id || '');
    setF((x) => ({ ...x, customer_name: '', customer_phone: '', notes: '', guests: '', amount: '', date: defaults?.date || todayIst(), space_id: defaults?.spaceId || '', slot: defaults?.slot || 'EVENING' }));
    setError(null);
    setConflict(null);
  }, [open, defaults, me.venues]);
  useEffect(() => {
    if (spaces.length && !spaces.some((s) => s.id === f.space_id)) setF((x) => ({ ...x, space_id: spaces[0].id }));
  }, [spaces, f.space_id]);

  const submit = async () => {
    setError(null);
    setConflict(null);
    if (!f.customer_name.trim()) return setError('Customer name is required');
    if (!f.space_id) return setError('Choose a space');
    if (!f.date) return setError('Choose a date');
    setPending(true);
    try {
      const b = await bizApi.post<BookingFull>('/business/offline-bookings', { ...f, customer_phone: f.customer_phone.trim() || undefined, guests: f.guests || 0, amount: f.amount || 0 });
      toast(`Booked ${b.code}. Inventory blocked.`);
      onDone?.(b);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SLOT_UNAVAILABLE') setConflict(e.message);
      else setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add offline booking"
      width={640}
      footer={
        <Button size="lg" variant="accent" block onClick={submit} pending={pending} disabled={loading || !spaces.length}>
          BLOCK INVENTORY
        </Button>
      }
    >
      <div className="stack">
        <p className="muted">Booked over the phone, WhatsApp or walk-in? Add it here so the slot is blocked for online customers instantly.</p>
        {conflict && (
          <Banner tone="danger" title="That slot is already taken">
            {conflict}
          </Banner>
        )}
        <div className="form-grid">
          <Field label="Customer name" required>
            <Input value={f.customer_name} maxLength={80} onChange={(e) => setF({ ...f, customer_name: e.target.value })} autoFocus />
          </Field>
          <Field label="Phone" hint="Optional, 10-digit mobile">
            <Input type="tel" inputMode="numeric" value={f.customer_phone} onChange={(e) => setF({ ...f, customer_phone: e.target.value })} />
          </Field>
          <VenueSelect value={venueId} onChange={setVenueId} />
          <Field label="Date" required>
            <Input type="date" value={f.date} min={todayIst()} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Space" required>
            <Select value={f.space_id} disabled={loading} onChange={(e) => setF({ ...f, space_id: e.target.value })} options={spaces.map((s) => ({ value: s.id, label: `${s.name} (${s.capacity_floating})` }))} placeholder={loading ? 'Loading…' : spaces.length ? undefined : 'No active spaces'} />
          </Field>
          <Field label="Time slot" className="span-2">
            <Segmented value={f.slot} onChange={(v) => setF({ ...f, slot: v })} options={SLOT_OPTIONS} />
          </Field>
          <Field label="Source">
            <Select value={f.source_channel} onChange={(e) => setF({ ...f, source_channel: e.target.value })} options={['phone', 'walk_in', 'whatsapp', 'existing_customer', 'other'].map((c) => ({ value: c, label: titleCase(c) }))} />
          </Field>
          <Field label="Event type">
            <Select value={f.event_type} onChange={(e) => setF({ ...f, event_type: e.target.value })} options={(meta.data?.event_categories || []).map((c) => ({ value: c.code, label: c.name }))} />
          </Field>
          <Field label="Guests">
            <NumberInput min={0} value={f.guests} onChange={(v) => setF({ ...f, guests: v })} />
          </Field>
          <Field label="Amount agreed">
            <NumberInput prefix="₹" min={0} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          </Field>
          <Field label="Notes" className="span-2">
            <Textarea value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Advance received, special requests…" />
          </Field>
        </div>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

export function HoldModal({ open, onClose, onDone, defaults, kind }: { open: boolean; onClose: () => void; onDone?: () => void; defaults?: InventoryDefaults; kind: 'BLOCK' | 'MAINTENANCE' }) {
  const { me } = useBiz();
  const toast = useToast();
  const [venueId, setVenueId] = useState('');
  const [f, setF] = useState({ space_id: 'ALL', date: '', slot: 'FULL_DAY' as Slot, note: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { spaces, loading } = useVenueSpaces(venueId, open);
  useEffect(() => {
    if (!open) return;
    setVenueId(defaults?.venueId || me.venues?.[0]?.id || '');
    setF({ space_id: defaults?.spaceId || 'ALL', date: defaults?.date || todayIst(), slot: defaults?.slot || 'FULL_DAY', note: '' });
    setError(null);
  }, [open, defaults, me.venues]);
  const submit = async () => {
    if (!f.date) return setError('Choose a date');
    const targets = f.space_id === 'ALL' ? spaces : spaces.filter((s) => s.id === f.space_id);
    if (!targets.length) return setError('No spaces to block');
    setPending(true);
    setError(null);
    const failed: string[] = [];
    for (const s of targets) {
      try {
        await bizApi.post('/business/holds', { space_id: s.id, date: f.date, slot: f.slot, kind, note: f.note || undefined });
      } catch (e) {
        failed.push(`${s.name}: ${errMsg(e)}`);
      }
    }
    setPending(false);
    const ok = targets.length - failed.length;
    if (ok) {
      toast(`${kind === 'BLOCK' ? 'Blocked' : 'Maintenance scheduled'} for ${ok} space${ok > 1 ? 's' : ''}`);
      onDone?.();
    }
    if (failed.length) setError(failed.join('\n'));
    else onClose();
  };
  const title = kind === 'BLOCK' ? 'Block date' : 'Create maintenance block';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={kind === 'BLOCK' ? 'primary' : 'secondary'} onClick={submit} pending={pending} disabled={loading}>
            {title}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">{kind === 'BLOCK' ? 'Closed for a private function, holiday or any reason. Customers will see the slot as unavailable.' : 'Repairs, painting or deep cleaning. The slot is unavailable to customers.'}</p>
        <div className="form-grid">
          <VenueSelect value={venueId} onChange={setVenueId} />
          <Field label="Date" required>
            <Input type="date" value={f.date} min={todayIst()} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Space">
            <Select value={f.space_id} disabled={loading} onChange={(e) => setF({ ...f, space_id: e.target.value })} options={[{ value: 'ALL', label: 'All spaces' }, ...spaces.map((s) => ({ value: s.id, label: s.name }))]} />
          </Field>
          <Field label="Slot" className="span-2">
            <Segmented value={f.slot} onChange={(v) => setF({ ...f, slot: v })} options={SLOT_OPTIONS} />
          </Field>
          <Field label="Note" className="span-2">
            <Input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={kind === 'BLOCK' ? 'e.g. Family function' : 'e.g. AC servicing'} />
          </Field>
        </div>
        {error && <InlineError message={error} />}
      </div>
    </Modal>
  );
}
