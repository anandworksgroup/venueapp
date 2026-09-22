import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Wordmark({ size = 24, light, to }: { size?: number; light?: boolean; to?: string }) {
  const mark = (
    <span className={`wordmark ${light ? 'wordmark-light' : ''}`} style={{ fontSize: size }}>
      pandal<span className="wordmark-dot">.</span>
    </span>
  );
  return to ? (
    <Link to={to} className="wordmark-link" aria-label="pandal home">
      {mark}
    </Link>
  ) : (
    mark
  );
}

/** Split-screen auth layout shared by both portals. */
export function AuthShell({ tag, title, subtitle, children, aside }: { tag: string; title: string; subtitle: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-art" aria-hidden="true">
        <div className="auth-art-inner">
          <Wordmark size={34} light />
          <p className="auth-tag">{tag}</p>
          {aside}
          <svg className="auth-garland" viewBox="0 0 400 120" preserveAspectRatio="none">
            <path d="M0 10 Q100 90 200 10 T400 10" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="2" />
            {Array.from({ length: 13 }, (_, i) => {
              const x = i * 33 + 2;
              const t = (x % 200) / 200;
              const y = 10 + 80 * 4 * t * (1 - t) * 0.5;
              return <circle key={i} cx={x} cy={y + 8} r={i % 2 ? 6 : 8} fill={i % 2 ? '#F4B545' : '#E8900C'} />;
            })}
          </svg>
        </div>
      </div>
      <div className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Timeline({ items }: { items: { title: ReactNode; meta?: ReactNode; body?: ReactNode; tone?: 'done' | 'current' | 'todo' | 'danger' }[] }) {
  return (
    <ol className="timeline">
      {items.map((it, i) => (
        <li key={i} className={`tl-item tl-${it.tone || 'done'}`}>
          <span className="tl-dot" aria-hidden="true" />
          <div className="tl-content">
            <div className="tl-title">{it.title}</div>
            {it.meta && <div className="tl-meta">{it.meta}</div>}
            {it.body && <div className="tl-body">{it.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
