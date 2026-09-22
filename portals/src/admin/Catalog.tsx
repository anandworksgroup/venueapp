import { useEffect, useState } from 'react';
import { adminApi, errMsg } from '../api';
import { date, money, titleCase } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { Icons } from '../shared/icons';
import { Async, Button, Card, Checkbox, EmptyState, Field, InlineError, Input, Modal, NumberInput, PageHeader, Pill, Segmented, Table, Tabs, useToast } from '../ui';
import { SearchBox } from './Customers';

// ─────────────── Categories ───────────────
interface Category {
  code: string;
  name: string;
  icon: string;
  sort: number;
  active: number;
}

export function CategoriesPage() {
  const state = useAsync(() => adminApi.get<{ items: Category[] }>('/admin/categories'), []);
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader title="Event categories" subtitle="What customers can search for. Venues pick from these." actions={<Button icon={Icons.plus} onClick={() => (setEditing(null), setOpen(true))}>Add category</Button>} />
      <Card pad={false}>
        <Async state={state}>
          {(d) => (
            <Table
              rows={d.items}
              rowKey={(c) => c.code}
              rowClassName={(c) => (c.active ? undefined : 'row-muted')}
              empty={<EmptyState title="No categories" />}
              columns={[
                { key: 's', header: 'Order', align: 'right', render: (c) => c.sort, width: 70 },
                { key: 'n', header: 'Name', render: (c) => <span className="cell-main">{c.name}</span> },
                { key: 'c', header: 'Code', render: (c) => <span className="mono">{c.code}</span> },
                { key: 'i', header: 'Icon', render: (c) => c.icon },
                { key: 'a', header: 'Status', render: (c) => (c.active ? <Pill tone="success">Active</Pill> : <Pill>Hidden</Pill>) },
                { key: 'x', header: '', align: 'right', render: (c) => <Button size="sm" variant="secondary" onClick={() => (setEditing(c), setOpen(true))}>Edit</Button> },
              ]}
            />
          )}
        </Async>
      </Card>
      <CategoryModal open={open} category={editing} onClose={() => setOpen(false)} onDone={state.reload} />
    </>
  );
}

function CategoryModal({ open, category, onClose, onDone }: { open: boolean; category: Category | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', icon: 'sparkle', sort: 99 as number | '', active: true });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setError(null);
      setF(category ? { code: category.code, name: category.name, icon: category.icon, sort: category.sort, active: Boolean(category.active) } : { code: '', name: '', icon: 'sparkle', sort: 99, active: true });
    }
  }, [open, category]);
  const submit = async () => {
    if (!/^[a-z_]{2,30}$/.test(f.code)) return setError('Code: 2–30 lowercase letters or underscores');
    setPending(true);
    setError(null);
    try {
      await adminApi.put(`/admin/categories/${f.code}`, { name: f.name, icon: f.icon, sort: f.sort === '' ? 99 : f.sort, active: f.active });
      toast('Category saved');
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={category ? `Edit ${category.name}` : 'Add category'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} pending={pending}>Save</Button></>}>
      <div className="form-grid">
        <Field label="Code" hint="Permanent id, e.g. mehendi">
          <Input value={f.code} disabled={!!category} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} />
        </Field>
        <Field label="Name" required>
          <Input value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Icon key">
          <Input value={f.icon} maxLength={30} onChange={(e) => setF({ ...f, icon: e.target.value })} />
        </Field>
        <Field label="Sort order">
          <NumberInput min={0} max={999} value={f.sort} onChange={(v) => setF({ ...f, sort: v })} />
        </Field>
        <div className="span-2">
          <Checkbox label="Active (visible to customers)" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
        </div>
      </div>
      <InlineError message={error} />
    </Modal>
  );
}

// ─────────────── Coupons ───────────────
interface Coupon {
  code: string;
  description: string | null;
  kind: 'percent' | 'flat';
  value: number;
  max_discount: number | null;
  min_subtotal: number;
  valid_from: string | null;
  valid_to: string | null;
  active: number;
}

export function CouponsPage() {
  const state = useAsync(() => adminApi.get<{ items: Coupon[] }>('/admin/coupons'), []);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader title="Coupons" subtitle="Discounts customers can apply at checkout." actions={<Button icon={Icons.plus} onClick={() => (setEditing(null), setOpen(true))}>Add coupon</Button>} />
      <Card pad={false}>
        <Async state={state}>
          {(d) => (
            <Table
              rows={d.items}
              rowKey={(c) => c.code}
              rowClassName={(c) => (c.active ? undefined : 'row-muted')}
              empty={<EmptyState title="No coupons yet" />}
              columns={[
                { key: 'c', header: 'Code', render: (c) => (<><div className="cell-main mono">{c.code}</div><div className="cell-sub">{c.description}</div></>) },
                { key: 'v', header: 'Discount', render: (c) => (c.kind === 'percent' ? `${c.value}%${c.max_discount ? ` (max ${money(c.max_discount)})` : ''}` : money(c.value)) },
                { key: 'm', header: 'Min booking', align: 'right', render: (c) => (c.min_subtotal ? money(c.min_subtotal) : '—') },
                { key: 'd', header: 'Valid', render: (c) => (c.valid_from || c.valid_to ? `${c.valid_from ? date(c.valid_from) : '…'} – ${c.valid_to ? date(c.valid_to) : '…'}` : 'Always') },
                { key: 'a', header: 'Status', render: (c) => (c.active ? <Pill tone="success">Active</Pill> : <Pill>Inactive</Pill>) },
                { key: 'x', header: '', align: 'right', render: (c) => <Button size="sm" variant="secondary" onClick={() => (setEditing(c), setOpen(true))}>Edit</Button> },
              ]}
            />
          )}
        </Async>
      </Card>
      <CouponModal open={open} coupon={editing} onClose={() => setOpen(false)} onDone={state.reload} />
    </>
  );
}

function CouponModal({ open, coupon, onClose, onDone }: { open: boolean; coupon: Coupon | null; onClose: () => void; onDone: () => void }) {
  const blank = { code: '', description: '', kind: 'percent' as 'percent' | 'flat', value: '' as number | '', max_discount: '' as number | '', min_subtotal: 0 as number | '', valid_from: '', valid_to: '', active: true };
  const [f, setF] = useState(blank);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setError(null);
      setF(coupon ? { code: coupon.code, description: coupon.description || '', kind: coupon.kind, value: coupon.value, max_discount: coupon.max_discount ?? '', min_subtotal: coupon.min_subtotal, valid_from: coupon.valid_from || '', valid_to: coupon.valid_to || '', active: Boolean(coupon.active) } : blank);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, coupon]);
  const submit = async () => {
    const code = f.code.toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) return setError('Code: 3–20 letters or digits');
    setPending(true);
    setError(null);
    try {
      await adminApi.put(`/admin/coupons/${code}`, { ...f, code, max_discount: f.max_discount === '' ? undefined : f.max_discount, min_subtotal: f.min_subtotal || 0, valid_from: f.valid_from || null, valid_to: f.valid_to || null });
      toast('Coupon saved');
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={coupon ? `Edit ${coupon.code}` : 'Add coupon'} width={620} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} pending={pending}>Save coupon</Button></>}>
      <div className="form-grid">
        <Field label="Code" required>
          <Input value={f.code} disabled={!!coupon} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="FESTIVE10" />
        </Field>
        <Field label="Type">
          <Segmented value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: 'percent', label: 'Percent' }, { value: 'flat', label: 'Flat ₹' }]} />
        </Field>
        <Field label={f.kind === 'percent' ? 'Percent off (1–90)' : 'Amount off'} required>
          <NumberInput prefix={f.kind === 'flat' ? '₹' : undefined} min={1} max={f.kind === 'percent' ? 90 : undefined} value={f.value} onChange={(v) => setF({ ...f, value: v })} />
        </Field>
        <Field label="Max discount" hint="Optional cap">
          <NumberInput prefix="₹" min={1} value={f.max_discount} onChange={(v) => setF({ ...f, max_discount: v })} />
        </Field>
        <Field label="Minimum booking value">
          <NumberInput prefix="₹" min={0} value={f.min_subtotal} onChange={(v) => setF({ ...f, min_subtotal: v })} />
        </Field>
        <Field label="Description">
          <Input value={f.description} maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Valid from">
          <Input type="date" value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} />
        </Field>
        <Field label="Valid to">
          <Input type="date" value={f.valid_to} onChange={(e) => setF({ ...f, valid_to: e.target.value })} />
        </Field>
        <div className="span-2">
          <Checkbox label="Active" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
        </div>
      </div>
      <InlineError message={error} />
    </Modal>
  );
}

// ─────────────── Locations ───────────────
interface City {
  id: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  venues: number;
}
interface Area {
  id: string;
  name: string;
  city_name: string;
  pincode: string | null;
  lat: number;
  lng: number;
  radius_km: number;
  aliases: string;
}

export function LocationsPage() {
  const state = useAsync(() => adminApi.get<{ cities: City[]; areas: Area[] }>('/admin/locations'), []);
  const [tab, setTab] = useState<'cities' | 'areas'>('cities');
  const [q, setQ] = useState('');
  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <>
      <PageHeader title="Locations" subtitle="Gazetteer used for location labels and search (read-only)." actions={<SearchBox value={q} onChange={setQ} placeholder="Filter by name or pincode" />} />
      <Card pad={false}>
        <Async state={state}>
          {(d) => (
            <>
              <div style={{ padding: '6px 12px 0' }}>
                <Tabs value={tab} onChange={setTab} items={[{ key: 'cities', label: 'Cities', count: d.cities.length }, { key: 'areas', label: 'Areas', count: d.areas.length }]} />
              </div>
              {tab === 'cities' ? (
                <Table
                  dense
                  rows={d.cities.filter((c) => match(`${c.name} ${c.state}`))}
                  rowKey={(c) => c.id}
                  empty={<EmptyState title="No cities match" />}
                  columns={[
                    { key: 'n', header: 'City', render: (c) => <span className="cell-main">{c.name}</span> },
                    { key: 's', header: 'State', render: (c) => c.state },
                    { key: 'v', header: 'Live venues', align: 'right', render: (c) => c.venues },
                    { key: 'l', header: 'Centre', render: (c) => <span className="mono small">{c.lat.toFixed(4)}, {c.lng.toFixed(4)}</span> },
                  ]}
                />
              ) : (
                <Table
                  dense
                  rows={d.areas.filter((a) => match(`${a.name} ${a.city_name} ${a.pincode || ''} ${a.aliases}`))}
                  rowKey={(a) => a.id}
                  empty={<EmptyState title="No areas match" />}
                  columns={[
                    { key: 'n', header: 'Area', render: (a) => <span className="cell-main">{a.name}</span> },
                    { key: 'c', header: 'City', render: (a) => a.city_name },
                    { key: 'p', header: 'Pincode', render: (a) => a.pincode || '—' },
                    { key: 'r', header: 'Radius', align: 'right', render: (a) => `${a.radius_km} km` },
                    { key: 'l', header: 'Centre', render: (a) => <span className="mono small">{a.lat.toFixed(4)}, {a.lng.toFixed(4)}</span>, hideSm: true },
                    { key: 'x', header: 'Aliases', render: (a) => { try { return (JSON.parse(a.aliases) as string[]).map(titleCase).join(', ') || '—'; } catch { return '—'; } }, hideSm: true },
                  ]}
                />
              )}
            </>
          )}
        </Async>
      </Card>
    </>
  );
}
