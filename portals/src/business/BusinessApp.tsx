import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { bizApi, tokens, UNAUTHORIZED_EVENT } from '../api';
import { Shell, type NavGroup, type NavItem } from '../shared/Shell';
import { Icons } from '../shared/icons';
import { Banner, ErrorState, IconButton, Loading } from '../ui';
import type { BusinessMe } from '../types';
import { BizContext, needsOnboarding, useBiz } from './context';
import { BusinessLogin, BusinessRegister } from './Auth';
import { Onboarding } from './Onboarding';
import { Verification } from './Verification';
import { Dashboard } from './Dashboard';
import { CalendarPage } from './Calendar';
import { BookingsPage } from './Bookings';
import { VenuePage } from './VenuePage';
import { ServicesPage } from './Services';
import { FinancePage } from './Finance';
import { ReviewsPage } from './Reviews';
import { NotificationsPage } from './Notifications';
import { ProfilePage } from './Profile';

export default function BusinessApp() {
  const [token, setToken] = useState<string | null>(() => tokens.get('business'));
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === 'business') setToken(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, on);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on);
  }, []);
  useEffect(() => {
    document.title = 'pandal. for business';
  }, []);
  const onLogin = (t: string) => {
    tokens.set('business', t);
    setToken(t);
  };
  const logout = () => {
    tokens.clear('business');
    setToken(null);
  };
  return (
    <Routes>
      <Route path="login" element={token ? <Navigate to="/business" replace /> : <BusinessLogin onLogin={onLogin} />} />
      <Route path="register" element={token ? <Navigate to="/business" replace /> : <BusinessRegister onLogin={onLogin} />} />
      <Route path="*" element={token ? <BizGate logout={logout} /> : <Navigate to="/business/login" replace />} />
    </Routes>
  );
}

function BizGate({ logout }: { logout: () => void }) {
  const [me, setMe] = useState<BusinessMe | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [unread, setUnread] = useState(0);
  const loc = useLocation();
  const reloadMe = useCallback(async () => {
    try {
      const m = await bizApi.get<BusinessMe>('/business/me');
      setMe(m);
      setError(null);
      return m;
    } catch (e) {
      setError(e);
      return null;
    }
  }, []);
  const refreshUnread = useCallback(() => {
    bizApi.get<{ unread: number }>('/business/notifications').then((r) => setUnread(r.unread), () => {});
  }, []);
  useEffect(() => {
    reloadMe();
  }, [reloadMe]);
  useEffect(() => {
    if (me?.business) refreshUnread();
  }, [me?.business, refreshUnread, loc.pathname]);

  if (error && !me) return <ErrorState error={error} onRetry={reloadMe} />;
  if (!me) return <Loading label="Opening your business…" />;
  const ctx = { me, reloadMe, unread, refreshUnread, logout };
  const onboarding = needsOnboarding(me);

  if (onboarding || loc.pathname.startsWith('/business/onboarding')) {
    return (
      <BizContext.Provider value={ctx}>
        <Routes>
          <Route path="onboarding/*" element={<Onboarding />} />
          <Route path="*" element={<Navigate to="/business/onboarding" replace />} />
        </Routes>
      </BizContext.Provider>
    );
  }
  return (
    <BizContext.Provider value={ctx}>
      <BizShellInner>
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="bookings/:id" element={<BookingsPage />} />
          <Route path="venue" element={<VenuePage />} />
          <Route path="venue/:venueId" element={<VenuePage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="finance" element={<FinancePage />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="verification" element={<Verification />} />
          <Route path="*" element={<Navigate to="/business" replace />} />
        </Routes>
      </BizShellInner>
    </BizContext.Provider>
  );
}


function BizShellInner({ children }: { children: ReactNode }) {
  const { me, unread, logout } = useBiz();
  const navigate = useNavigate();
  const b = me.business!;
  const primary: NavItem[] = [
    { to: '/business', label: 'Dashboard', icon: Icons.dashboard, end: true },
    { to: '/business/calendar', label: 'Calendar', icon: Icons.calendar },
    { to: '/business/bookings', label: 'Bookings', icon: Icons.bookings },
    { to: '/business/venue', label: 'Venue', icon: Icons.venue },
  ];
  const groups: NavGroup[] = [
    {
      items: [
        ...primary,
        { to: '/business/services', label: 'Services', icon: Icons.services },
        { to: '/business/finance', label: 'Finance', icon: Icons.finance },
        { to: '/business/profile', label: 'Profile', icon: Icons.profile },
      ],
    },
    {
      title: 'More',
      items: [
        { to: '/business/reviews', label: 'Reviews', icon: Icons.reviews },
        { to: '/business/notifications', label: 'Notifications', icon: Icons.bell, badge: unread },
        { to: '/business/verification', label: 'Verification', icon: Icons.shield },
      ],
    },
  ];
  const banner =
    b.status !== 'APPROVED' ? (
      <div className="shell-banner">
        <Banner
          tone={b.status === 'SUSPENDED' ? 'danger' : 'warning'}
          title={b.status === 'SUSPENDED' ? 'Your business is suspended' : 'Your business is being verified'}
          action={
            <Link className="btn btn-secondary btn-sm" to="/business/verification">
              View status
            </Link>
          }
        >
          {b.status === 'SUSPENDED' ? b.rejection_reason || 'Contact Pandal support.' : 'You can set up your calendar and venue while we review your documents. Venues go live after approval.'}
        </Banner>
      </div>
    ) : undefined;
  return (
    <Shell
      home="/business"
      portalLabel="Business"
      groups={groups}
      tabs={[...primary.slice(0, 3), { to: '/business/notifications', label: 'Alerts', icon: Icons.bell, badge: unread }]}
      banner={banner}
      userBlock={
        <div className="user-chip">
          <span className="avatar">{(b.name || '?').slice(0, 1).toUpperCase()}</span>
          <span className="who">
            <strong>{b.name}</strong>
            <span>{me.user.email}</span>
          </span>
          <IconButton
            label="Log out"
            onClick={() => {
              logout();
              navigate('/business/login');
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
