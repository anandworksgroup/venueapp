import { Fragment, useEffect, useState } from 'react';
import { adminApi, errMsg } from '../api';
import { dateTime, pct, titleCase } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { Icons } from '../shared/icons';
import { StatusPill } from '../shared/StatusPill';
import { Async, Banner, Button, Card, EmptyState, Field, InlineError, Input, Modal, NumberInput, PageHeader, Select, useToast } from '../ui';
import { useDebounced } from './Customers';

// ─────────────── Settings ───────────────
interface Settings {
  tax_rate_bps: number;
  hold_minutes: number;
  default_commission_bps: number;
}

export function SettingsPage() {
  const state = useAsync(() => adminApi.get<Settings>('/admin/settings'), []);
  return (
    <>
      <PageHeader title="Platform settings" subtitle="Changes apply to new quotes and bookings. Every change is audit-logged." />
      <Async state={state}>{(s) => <SettingsForm initial={s} onSaved={state.reload} />}</Async>
    </>
  );
}

function SettingsForm({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const [gst, setGst] = useState<number | ''>(initial.tax_rate_bps / 100);
  const [hold, setHold] = useState<number | ''>(initial.hold_minutes);
  const [comm, setComm] = useState<number | ''>(initial.default_commission_bps / 100);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await adminApi.put('/admin/settings', { tax_rate_bps: gst === '' ? undefined : Math.round(Number(gst) * 100), hold_minutes: hold === '' ? undefined : hold, default_commission_bps: comm === '' ? undefined : Math.round(Number(comm) * 100) });
      toast('Settings saved');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Card>
      <div className="form-grid-3">
        <Field label="GST on bookings (%)" hint={`Currently ${pct(initial.tax_rate_bps)} (${initial.tax_rate_bps} bps)`}>
          <NumberInput min={0} max={28} step={0.5} value={gst} onChange={setGst} />
        </Field>
        <Field label="Checkout hold (minutes)" hint="How long a slot is held while the customer pays (5–60)">
          <NumberInput min={5} max={60} value={hold} onChange={setHold} />
        </Field>
        <Field label="Default commission for new businesses (%)" hint={`Currently ${pct(initial.default_commission_bps)}`}>
          <NumberInput min={0} max={50} step={0.25} value={comm} onChange={setComm} />
        </Field>
      </div>
      <InlineError message={error} />
      <div className="mt">
        <Button onClick={save} pending={pending}>
          Save settings
        </Button>
      </div>
    </Card>
  );
}

// ─────────────── Admins ───────────────
interface AdminUser {
  id: string;
  name: string;
  email: string;
  admin_role: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
}

export function AdminsPage() {
  const state = useAsync(() => adminApi.get<{ items: AdminUser[]; roles: Record<string, string[]> }>('/admin/admins'), []);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ email: string; admin_role: string; totp_secret?: string; otpauth_url?: string } | null>(null);
  return (
    <>
      <PageHeader title="Admins" subtitle="People who can sign in to this portal." actions={<Button icon={Icons.plus} onClick={() => setOpen(true)}>Add admin</Button>} />
      {created && created.totp_secret && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning" title={`Save this now: 2FA secret for ${created.email}`} action={<Button size="sm" variant="secondary" onClick={() => setCreated(null)}>I've saved it</Button>}>
            <div className="secret-box" style={{ marginTop: 8 }}>
              <div>
                <strong>Secret:</strong> <span className="mono">{created.totp_secret}</span>
              </div>
              <div style={{ marginTop: 6 }}>
                <strong>otpauth URL:</strong> <span className="mono">{created.otpauth_url}</span>
              </div>
            </div>
            <p className="small" style={{ marginTop: 8 }}>
              This is shown only once. Share it securely with the new admin to add to their authenticator app. Pandal cannot show it again.
            </p>
          </Banner>
        </div>
      )}
      <Async state={state}>
        {(d) => (
          <div className="split">
            <Card pad={false}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Admin</th>
                    <th>Role</th>
                    <th>Last login</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Admin">
                        <div className="cell-main">{a.name}</div>
                        <div className="cell-sub">{a.email}</div>
                      </td>
                      <td data-label="Role">{titleCase(a.admin_role)}</td>
                      <td data-label="Last login">{a.last_login_at ? dateTime(a.last_login_at) : 'Never'}</td>
                      <td data-label="Status">
                        <StatusPill status={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Roles & permissions">
              {Object.entries(d.roles).map(([role, perms]) => (
                <div key={role} style={{ marginBottom: 12 }}>
                  <strong>{titleCase(role)}</strong>
                  <div className="muted small">{perms.includes('*') ? 'Everything' : perms.join(', ')}</div>
                </div>
              ))}
            </Card>
          </div>
        )}
      </Async>
      <CreateAdminModal
        open={open}
        roles={Object.keys(state.data?.roles || { super_admin: [], ops: [], finance: [], support: [] })}
        onClose={() => setOpen(false)}
        onCreated={(c) => {
          setCreated(c);
          state.reload();
        }}
      />
    </>
  );
}

function CreateAdminModal({ open, roles, onClose, onCreated }: { open: boolean; roles: string[]; onClose: () => void; onCreated: (c: { email: string; admin_role: string; totp_secret?: string; otpauth_url?: string }) => void }) {
  const [f, setF] = useState({ name: '', email: '', password: '', admin_role: 'support' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF({ name: '', email: '', password: '', admin_role: 'support' });
      setError(null);
    }
  }, [open]);
  const submit = async () => {
    if (f.password.length < 10) return setError('Temporary password must be at least 10 characters');
    setPending(true);
    setError(null);
    try {
      const r = await adminApi.post<{ email: string; admin_role: string; totp_secret?: string; otpauth_url?: string }>('/admin/admins', f);
      onCreated(r);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add admin" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} pending={pending}>Create admin</Button></>}>
      <div className="form-grid">
        <Field label="Name" required>
          <Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Email" required>
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Temporary password" required hint="At least 10 characters">
          <Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Role">
          <Select value={f.admin_role} onChange={(e) => setF({ ...f, admin_role: e.target.value })} options={roles.map((r) => ({ value: r, label: titleCase(r) }))} />
        </Field>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        They sign in with this email and password.
      </p>
      <InlineError message={error} />
    </Modal>
  );
}

// ─────────────── Audit logs ───────────────
interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  at: string;
}

export function AuditLogsPage() {
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [action, setAction] = useState('');
  const et = useDebounced(entityType);
  const ei = useDebounced(entityId);
  const ac = useDebounced(action);
  const state = useAsync(() => adminApi.get<{ items: AuditRow[] }>('/admin/audit-logs', { entity_type: et, entity_id: ei, action: ac, limit: 200 }), [et, ei, ac]);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Audit logs" subtitle="Every admin and business mutation, newest first." />
      <Card>
        <div className="form-grid-3">
          <Field label="Entity type">
            <Input value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="business, venue, booking…" />
          </Field>
          <Field label="Entity id">
            <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="e.g. biz_sukh" />
          </Field>
          <Field label="Action starts with">
            <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="venue., payout., admin.login" />
          </Field>
        </div>
      </Card>
      <div className="mt">
        <Card pad={false}>
          <Async state={state}>
            {(d) =>
              d.items.length === 0 ? (
                <EmptyState title="No audit entries match" />
              ) : (
                <div className="table-wrap">
                  <table className="table table-dense table-click">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Actor</th>
                        <th>Action</th>
                        <th>Entity</th>
                        <th>IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((a) => (
                        <Fragment key={a.id}>
                          <tr onClick={() => setExpanded(expanded === a.id ? null : a.id)} aria-expanded={expanded === a.id}>
                            <td data-label="When" className="nowrap">{dateTime(a.at)}</td>
                            <td data-label="Actor">
                              <div>{a.actor_name || a.actor_email || 'System'}</div>
                              <div className="cell-sub">{a.actor_role}</div>
                            </td>
                            <td data-label="Action">
                              <span className="mono">{a.action}</span>
                            </td>
                            <td data-label="Entity">
                              <span className="mono small">
                                {a.entity_type}:{a.entity_id}
                              </span>
                            </td>
                            <td data-label="IP" className="mono small">{a.ip || '—'}</td>
                          </tr>
                          {expanded === a.id && (
                            <tr>
                              <td colSpan={5} data-label="">
                                <div className="grid-2" style={{ width: '100%', textAlign: 'left' }}>
                                  <div>
                                    <div className="field-label">Before</div>
                                    <pre className="json">{JSON.stringify(a.before, null, 2) ?? 'null'}</pre>
                                  </div>
                                  <div>
                                    <div className="field-label">After</div>
                                    <pre className="json">{JSON.stringify(a.after, null, 2) ?? 'null'}</pre>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Async>
        </Card>
      </div>
    </>
  );
}
