import { useEffect, useState } from 'react';
import { adminApi } from '../api';
import { dateTime, money } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { Icons } from '../shared/icons';
import { StatusPill } from '../shared/StatusPill';
import { Async, Button, Card, ConfirmDialog, EmptyState, Input, PageHeader, Table, useToast } from '../ui';
import { useAdmin } from './context';

interface Customer {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  status: string;
  created_at: string;
  last_login_at: string | null;
  bookings: number;
  spent: number;
}

export function useDebounced(v: string, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v.trim()), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="search-input">
      {Icons.search}
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

export function CustomersPage() {
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const state = useAsync(() => adminApi.get<{ items: Customer[]; total: number }>('/admin/customers', { q: search, limit: 200 }), [search]);
  const [target, setTarget] = useState<Customer | null>(null);
  const { can } = useAdmin();
  const toast = useToast();
  return (
    <>
      <PageHeader title="Customers" subtitle={state.data ? `${state.data.total} customers` : undefined} actions={<SearchBox value={q} onChange={setQ} placeholder="Search name, phone or email" />} />
      <Card pad={false}>
        <Async state={state}>
          {(d) => (
            <Table
              rows={d.items}
              rowKey={(c) => c.id}
              empty={<EmptyState title="No customers found" />}
              columns={[
                { key: 'n', header: 'Customer', render: (c) => (<><div className="cell-main">{c.name || 'Unnamed'}</div><div className="cell-sub">{c.email || '—'}</div></>) },
                { key: 'p', header: 'Phone', render: (c) => c.phone },
                { key: 'b', header: 'Bookings', align: 'right', render: (c) => c.bookings },
                { key: 's', header: 'Paid', align: 'right', render: (c) => money(c.spent) },
                { key: 'j', header: 'Joined', render: (c) => dateTime(c.created_at), hideSm: true },
                { key: 'l', header: 'Last login', render: (c) => (c.last_login_at ? dateTime(c.last_login_at) : '—'), hideSm: true },
                { key: 'st', header: 'Status', render: (c) => <StatusPill status={c.status} /> },
                {
                  key: 'a',
                  header: '',
                  align: 'right',
                  render: (c) =>
                    can('businesses.verify') ? (
                      <Button size="sm" variant={c.status === 'BLOCKED' ? 'secondary' : 'ghost'} onClick={() => setTarget(c)}>
                        {c.status === 'BLOCKED' ? 'Unblock' : 'Block'}
                      </Button>
                    ) : null,
                },
              ]}
            />
          )}
        </Async>
      </Card>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={target?.status === 'BLOCKED' ? `Unblock ${target?.name || 'customer'}?` : `Block ${target?.name || 'customer'}?`}
        message={target?.status === 'BLOCKED' ? 'They will be able to sign in and book again.' : 'They will be signed out and unable to sign in or book.'}
        confirmLabel={target?.status === 'BLOCKED' ? 'Unblock' : 'Block customer'}
        danger={target?.status !== 'BLOCKED'}
        reasonLabel="Reason"
        reasonOptional={target?.status === 'BLOCKED'}
        onConfirm={async (reason) => {
          await adminApi.post(`/admin/customers/${target!.id}/status`, { status: target!.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED', reason });
          toast('Customer updated');
          state.reload();
        }}
      />
    </>
  );
}
