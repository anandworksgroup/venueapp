import { useEffect, useState } from 'react';
import { bizApi, errMsg } from '../api';
import { money, titleCase } from '../shared/format';
import { useAsync, useMeta } from '../shared/hooks';
import { Icons } from '../shared/icons';
import { Async, Button, Card, EmptyState, Field, InlineError, Input, Modal, NumberInput, PageHeader, Pill, Segmented, Select, Table, Textarea, useToast } from '../ui';
import type { ServiceRow } from '../types';
import { useBiz } from './context';
import { loadVenue } from './steps/VenueForms';

type Form = { category: string; name: string; description: string; pricing_mode: 'flat' | 'per_guest'; price: number | '' };
const blank: Form = { category: 'catering', name: '', description: '', pricing_mode: 'flat', price: '' };

export function ServicesPage() {
  const { me } = useBiz();
  const venues = me.venues || [];
  const [venueId, setVenueId] = useState(venues[0]?.id || '');
  const state = useAsync(() => (venueId ? loadVenue(venueId) : Promise.reject(new Error('Add a venue first'))), [venueId]);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const toggle = async (s: ServiceRow) => {
    setBusy(s.id);
    setError(null);
    try {
      await bizApi.put(`/business/venues/${venueId}/services/${s.id}`, { active: !s.active });
      toast(s.active ? 'Service hidden from customers' : 'Service active');
      state.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <PageHeader
        title="Add-on services"
        subtitle="Extras customers can add at checkout: catering, décor, DJ, photography and more."
        actions={
          <>
            {venues.length > 1 && <Select aria-label="Venue" value={venueId} onChange={(e) => setVenueId(e.target.value)} options={venues.map((v) => ({ value: v.id, label: v.name }))} />}
            <Button icon={Icons.plus} onClick={() => (setEditing(null), setOpen(true))} disabled={!venueId}>
              Add service
            </Button>
          </>
        }
      />
      <Card pad={false}>
        <Async state={state}>
          {(v) => (
            <Table
              rows={v.all_services || []}
              rowKey={(s) => s.id}
              rowClassName={(s) => (s.active ? undefined : 'row-muted')}
              empty={<EmptyState title="No add-on services yet" body="Services increase your booking value. Add catering per guest, décor packages or a DJ." action={<Button icon={Icons.plus} onClick={() => (setEditing(null), setOpen(true))}>Add service</Button>} />}
              columns={[
                { key: 'n', header: 'Service', render: (s) => (<><div className="cell-main">{s.name}</div>{s.description && <div className="cell-sub">{s.description}</div>}</>) },
                { key: 'c', header: 'Category', render: (s) => <Pill tone="teal">{titleCase(s.category)}</Pill> },
                { key: 'p', header: 'Price', align: 'right', render: (s) => (s.pricing_mode === 'per_guest' ? `${money(s.price)} / guest` : money(s.price)) },
                { key: 's', header: 'Status', render: (s) => (s.active ? <Pill tone="success">Active</Pill> : <Pill>Hidden</Pill>) },
                {
                  key: 'a',
                  header: '',
                  align: 'right',
                  render: (s) => (
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="secondary" onClick={(e) => (e.stopPropagation(), setEditing(s), setOpen(true))}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" pending={busy === s.id} onClick={() => toggle(s)}>
                        {s.active ? 'Hide' : 'Activate'}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Async>
        <div style={{ padding: '0 16px 12px' }}>
          <InlineError message={error} />
        </div>
      </Card>
      <ServiceModal venueId={venueId} service={editing} open={open} onClose={() => setOpen(false)} onDone={state.reload} />
    </>
  );
}

function ServiceModal({ venueId, service, open, onClose, onDone }: { venueId: string; service: ServiceRow | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const meta = useMeta();
  const [f, setF] = useState<Form>(blank);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setError(null);
      setF(service ? { category: service.category, name: service.name, description: service.description || '', pricing_mode: service.pricing_mode, price: service.price } : blank);
    }
  }, [open, service]);
  const submit = async () => {
    if (!f.name.trim()) return setError('Service name is required');
    if (!f.price) return setError('Enter a price');
    setPending(true);
    setError(null);
    try {
      if (service) await bizApi.put(`/business/venues/${venueId}/services/${service.id}`, { ...f, active: Boolean(service.active) });
      else await bizApi.post(`/business/venues/${venueId}/services`, f);
      toast(service ? 'Service updated' : 'Service added');
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={service ? 'Edit service' : 'Add service'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} pending={pending}>
            {service ? 'Save service' : 'Add service'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Category">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={(meta.data?.service_categories || ['catering', 'decoration', 'dj', 'photography', 'invitation', 'other']).map((c) => ({ value: c, label: titleCase(c) }))} />
          </Field>
          <Field label="Name" required>
            <Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Floral stage décor" />
          </Field>
          <Field label="Pricing">
            <Segmented value={f.pricing_mode} onChange={(v) => setF({ ...f, pricing_mode: v })} options={[{ value: 'flat', label: 'Flat' }, { value: 'per_guest', label: 'Per guest' }]} />
          </Field>
          <Field label={f.pricing_mode === 'per_guest' ? 'Price per guest' : 'Price'} required>
            <NumberInput prefix="₹" min={1} value={f.price} onChange={(v) => setF({ ...f, price: v })} />
          </Field>
          <Field label="Description" className="span-2">
            <Textarea value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </div>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}
