import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { publicApi, errMsg } from '../api';
import { AuthShell } from '../shared/Brand';
import { Button, Field, InlineError, Input } from '../ui';

const Points = () => (
  <ul className="auth-points">
    <li>Real-time calendar: online and offline bookings in one place</li>
    <li>Payments verified server-side, payouts to your bank</li>
    <li>Your exact map pin, so customers find the right gate</li>
  </ul>
);

export function BusinessLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const r = await publicApi.post<{ token: string }>('/auth/login', { email: email.trim(), password, portal: 'business' });
      onLogin(r.token);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthShell tag="Fill your calendar. Keep every booking in one place." title="Sign in to your business" subtitle="Venue owners and managers" aside={<Points />}>
      <form onSubmit={submit}>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <InlineError message={error} />
        <Button type="submit" size="lg" block pending={pending}>
          Sign in
        </Button>
        <p className="muted" style={{ textAlign: 'center' }}>
          New to Pandal? <Link to="/business/register">List your business</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function BusinessRegister({ onLogin }: { onLogin: (token: string) => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const r = await publicApi.post<{ token: string }>('/auth/register-business', { ...f, email: f.email.trim() });
      onLogin(r.token);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthShell tag="List your venue on Pandal. It's free to start." title="Create your business account" subtitle="You'll set up your venue right after this." aside={<Points />}>
      <form onSubmit={submit}>
        <Field label="Your name">
          <Input value={f.name} onChange={set('name')} required autoComplete="name" autoFocus />
        </Field>
        <Field label="Work email">
          <Input type="email" value={f.email} onChange={set('email')} required autoComplete="email" />
        </Field>
        <Field label="Mobile number" hint="10-digit Indian mobile">
          <Input type="tel" inputMode="numeric" value={f.phone} onChange={set('phone')} required autoComplete="tel" placeholder="98XXXXXXXX" />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <Input type="password" value={f.password} onChange={set('password')} required autoComplete="new-password" />
        </Field>
        <InlineError message={error} />
        <Button type="submit" size="lg" block pending={pending}>
          Create account
        </Button>
        <p className="muted" style={{ textAlign: 'center' }}>
          Already on Pandal? <Link to="/business/login">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
