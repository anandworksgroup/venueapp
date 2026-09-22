import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { adminApi, ApiError, errMsg, publicApi, tokens, UNAUTHORIZED_EVENT } from '../api';
import { AuthShell } from '../shared/Brand';
import { Icons } from '../shared/icons';
import { Shell, type NavGroup, type NavItem } from '../shared/Shell';
import { titleCase } from '../shared/format';
import { Button, ErrorState, Field, IconButton, InlineError, Input, Loading } from '../ui';
import type { User } from '../types';
import { AdminContext, useAdmin } from './context';
import { AdminDashboard } from './Dashboard';
import { CustomersPage } from './Customers';
import { BusinessesPage, BusinessDetailPage } from './Businesses';
import { VenuesPage, VenueDetailPage } from './Venues';
import { AdminBookingsPage } from './Bookings';
import { PaymentsPage, ReconciliationPage, RefundsPage, PayoutsPage, LedgerPage } from './MoneyPages';
import { ReviewsModeration, DisputesPage } from './Moderation';
import { CategoriesPage, CouponsPage, LocationsPage } from './Catalog';
import { SettingsPage, AdminsPage, AuditLogsPage } from './System';

export default function AdminApp() {
  const [token, setToken] = useState<string | null>(() => tokens.get('admin'));
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === 'admin') setToken(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, on);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on);
  }, []);
  useEffect(() => {
    document.title = 'pandal. admin';
  }, []);
  const logout = () => {
    tokens.clear('admin');
    setToken(null);
  };
  return (
    <Routes>
      <Route
        path="login"
        element={
          token ? (
            <Navigate to="/admin" replace />
          ) : (
            <AdminLogin
              onLogin={(t) => {
                tokens.set('admin', t);
                setToken(t);
              }}
            />
          )
        }
      />
      <Route path="*" element={token ? <AdminGate logout={logout} /> : <Navigate to="/admin/login" replace />} />
    </Routes>
  );
}

function AdminLogin({ onLogin }: { onLogin: (t: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totpError, setTotpError] = useState<string | null>(null);
  // Only shown when the server has two-factor login turned on (ADMIN_2FA=on).
  const [needsTotp, setNeedsTotp] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setTotpError(null);
    if (needsTotp && !/^\d{6}$/.test(totp)) {
      setTotpError('Enter the 6-digit code from your authenticator app');
      return;
    }
    setPending(true);
    try {
      const r = await publicApi.post<{ token: string }>('/auth/login', { email: email.trim(), password, ...(needsTotp ? { totp } : {}), portal: 'admin' });
      onLogin(r.token);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'TOTP_REQUIRED' || err.code === 'TOTP_INVALID')) {
        setNeedsTotp(true);
        setTotpError(err.code === 'TOTP_INVALID' ? 'That code is incorrect or expired. Codes change every 30 seconds.' : err.message);
        setTotp('');
      } else setError(errMsg(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthShell
      tag="Keep the marketplace trustworthy: verify, settle, resolve."
      title="Admin sign in"
      subtitle="Sign in with your admin email and password."
      aside={
        <ul className="auth-points">
          <li>Every action is permission-checked and audit-logged</li>
          <li>Double-entry ledger, reconciled with the gateway</li>
        </ul>
      }
    >
      <form onSubmit={submit}>
        <Field label="Email">
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {needsTotp && (
          <Field label="2FA code" error={totpError} hint="6 digits from your authenticator app">
            <Input className="input-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" autoFocus />
          </Field>
        )}
        {needsTotp && import.meta.env.DEV && (
          <div className="dev-hint">
            Dev: run <code>npm run totp</code> in <code>backend/</code> for the current code.
          </div>
        )}
        <InlineError message={error} />
        <Button type="submit" size="lg" block pending={pending}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

function AdminGate({ logout }: { logout: () => void }) {
  const [me, setMe] = useState<{ user: User; permissions: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    adminApi.get<{ user: User; permissions: string[] }>('/admin/me').then(setMe, setError);
  }, []);
  useEffect(load, [load]);
  if (error && !me) return <ErrorState error={error} onRetry={load} />;
  if (!me) return <Loading label="Opening admin…" />;
  const can = (p: string) => me.permissions.includes('*') || me.permissions.includes(p);
  return (
    <AdminContext.Provider value={{ user: me.user, permissions: me.permissions, can, logout }}>
      <AdminShell>
        <Routes>
          <Route index element={<Guard perm="dashboard"><AdminDashboard /></Guard>} />
          <Route path="customers" element={<Guard perm="customers.read"><CustomersPage /></Guard>} />
          <Route path="businesses" element={<Guard perm="businesses.read"><BusinessesPage /></Guard>} />
          <Route path="businesses/:id" element={<Guard perm="businesses.read"><BusinessDetailPage /></Guard>} />
          <Route path="venues" element={<Guard perm="venues.read"><VenuesPage /></Guard>} />
          <Route path="venues/:id" element={<Guard perm="venues.read"><VenueDetailPage /></Guard>} />
          <Route path="bookings" element={<Guard perm="bookings.read"><AdminBookingsPage /></Guard>} />
          <Route path="bookings/:id" element={<Guard perm="bookings.read"><AdminBookingsPage /></Guard>} />
          <Route path="payments" element={<Guard perm="payments.read"><PaymentsPage /></Guard>} />
          <Route path="refunds" element={<Guard perm="refunds.manage"><RefundsPage /></Guard>} />
          <Route path="payouts" element={<Guard perm="payouts.manage"><PayoutsPage /></Guard>} />
          <Route path="ledger" element={<Guard perm="finance.read"><LedgerPage /></Guard>} />
          <Route path="reconciliation" element={<Guard perm="finance.read"><ReconciliationPage /></Guard>} />
          <Route path="reviews" element={<Guard perm="reviews.moderate"><ReviewsModeration /></Guard>} />
          <Route path="disputes" element={<Guard perm="disputes.manage"><DisputesPage /></Guard>} />
          <Route path="categories" element={<Guard perm="catalog.manage"><CategoriesPage /></Guard>} />
          <Route path="coupons" element={<Guard perm="catalog.manage"><CouponsPage /></Guard>} />
          <Route path="locations" element={<Guard perm="catalog.manage"><LocationsPage /></Guard>} />
          <Route path="settings" element={<Guard perm="*"><SettingsPage /></Guard>} />
          <Route path="admins" element={<Guard perm="*"><AdminsPage /></Guard>} />
          <Route path="audit-logs" element={<Guard perm="audit.read"><AuditLogsPage /></Guard>} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AdminShell>
    </AdminContext.Provider>
  );
}

/** Friendly panel when the role lacks a permission (the API enforces it too). */
function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can, user } = useAdmin();
  if (perm === '*' ? !can('*') : !can(perm)) {
    return <ErrorState error={new ApiError(403, 'FORBIDDEN', `Your admin role (${user.admin_role}) lacks "${perm === '*' ? 'super admin' : perm}"`)} />;
  }
  return <>{children}</>;
}

function AdminShell({ children }: { children: ReactNode }) {
  const { user, can, logout } = useAdmin();
  const navigate = useNavigate();
  const all: { title?: string; items: (NavItem & { perm: string })[] }[] = [
    { items: [{ to: '/admin', label: 'Dashboard', icon: Icons.dashboard, end: true, perm: 'dashboard' }] },
    {
      title: 'Marketplace',
      items: [
        { to: '/admin/customers', label: 'Customers', icon: Icons.users, perm: 'customers.read' },
        { to: '/admin/businesses', label: 'Businesses', icon: Icons.business, perm: 'businesses.read' },
        { to: '/admin/venues', label: 'Venues', icon: Icons.venue, perm: 'venues.read' },
        { to: '/admin/bookings', label: 'Bookings', icon: Icons.bookings, perm: 'bookings.read' },
      ],
    },
    {
      title: 'Money',
      items: [
        { to: '/admin/payments', label: 'Payments', icon: Icons.card, perm: 'payments.read' },
        { to: '/admin/refunds', label: 'Refunds', icon: Icons.refund, perm: 'refunds.manage' },
        { to: '/admin/payouts', label: 'Payouts', icon: Icons.payout, perm: 'payouts.manage' },
        { to: '/admin/ledger', label: 'Finance & ledger', icon: Icons.ledger, perm: 'finance.read' },
        { to: '/admin/reconciliation', label: 'Reconciliation', icon: Icons.scale, perm: 'finance.read' },
      ],
    },
    {
      title: 'Trust',
      items: [
        { to: '/admin/reviews', label: 'Reviews', icon: Icons.reviews, perm: 'reviews.moderate' },
        { to: '/admin/disputes', label: 'Disputes', icon: Icons.flag, perm: 'disputes.manage' },
      ],
    },
    {
      title: 'Catalog',
      items: [
        { to: '/admin/categories', label: 'Categories', icon: Icons.tag, perm: 'catalog.manage' },
        { to: '/admin/coupons', label: 'Coupons', icon: Icons.ticket, perm: 'catalog.manage' },
        { to: '/admin/locations', label: 'Locations', icon: Icons.map, perm: 'catalog.manage' },
      ],
    },
    {
      title: 'System',
      items: [
        { to: '/admin/settings', label: 'Settings', icon: Icons.settings, perm: '*' },
        { to: '/admin/admins', label: 'Admins', icon: Icons.shield, perm: '*' },
        { to: '/admin/audit-logs', label: 'Audit logs', icon: Icons.log, perm: 'audit.read' },
      ],
    },
  ];
  const groups: NavGroup[] = all.map((g) => ({ ...g, items: g.items.filter((i) => (i.perm === '*' ? can('*') : can(i.perm))) })).filter((g) => g.items.length);
  return (
    <Shell
      home="/admin"
      portalLabel="Admin"
      groups={groups}
      userBlock={
        <div className="user-chip">
          <span className="avatar">{(user.name || '?').slice(0, 1).toUpperCase()}</span>
          <span className="who">
            <strong>{user.name}</strong>
            <span>{titleCase(user.admin_role)}</span>
          </span>
          <IconButton
            label="Log out"
            onClick={() => {
              logout();
              navigate('/admin/login');
            }}
          >
            {Icons.logout}
          </IconButton>
        </div>
      }
    >
      {children}
    </Shell>
  );
}
