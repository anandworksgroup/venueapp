import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { Wordmark } from './shared/Brand';
import { Icons } from './shared/icons';
import { Loading } from './ui';

const BusinessApp = lazy(() => import('./business/BusinessApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

function Landing() {
  return (
    <div className="landing">
      <Wordmark size={46} />
      <p className="muted" style={{ fontSize: 16, textAlign: 'center', maxWidth: 460 }}>
        Venues and events, booked the right way. Choose your portal.
      </p>
      <div className="landing-cards">
        <Link to="/business" className="landing-card">
          <span className="lc-icon">{Icons.venue}</span>
          <h2>Business portal</h2>
          <span className="muted">List your venue, manage the calendar, bookings, payouts and reviews.</span>
          <span className="go">Open business portal →</span>
        </Link>
        <Link to="/admin" className="landing-card alt">
          <span className="lc-icon">{Icons.shield}</span>
          <h2>Admin portal</h2>
          <span className="muted">Verify businesses and venues, run payouts, check the ledger and moderate.</span>
          <span className="go">Open admin portal →</span>
        </Link>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<Loading label="Loading portal…" />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/business/*" element={<BusinessApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </Suspense>
  );
}
