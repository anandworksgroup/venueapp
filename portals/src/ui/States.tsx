import type { ReactNode } from 'react';
import { ApiError } from '../api';
import type { AsyncState } from '../shared/hooks';

export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner-wrap" role="status" aria-label={label || 'Loading'}>
      <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label && <span className="spinner-label">{label}</span>}
    </span>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state state-loading">
      <Spinner size={26} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="state state-empty">
      <div className="state-icon" aria-hidden="true">
        {icon || (
          <svg width="40" height="40" viewBox="0 0 40 40">
            <rect x="6" y="10" width="28" height="22" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M6 17h28" stroke="currentColor" strokeWidth="2" />
            <circle cx="30" cy="30" r="5" fill="var(--accent)" />
          </svg>
        )}
      </div>
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) {
    return (
      <div className="state state-forbidden">
        <div className="state-icon" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40">
            <rect x="9" y="18" width="22" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M14 18v-4a6 6 0 0 1 12 0v4" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </div>
        <strong>Your role can't access this</strong>
        <p>{error.message}. Ask a super admin if you need it.</p>
      </div>
    );
  }
  const msg = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="state state-error" role="alert">
      <strong>Couldn't load this</strong>
      <p>{msg}</p>
      {onRetry && (
        <button className="btn btn-secondary btn-sm" onClick={onRetry} type="button">
          Try again
        </button>
      )}
    </div>
  );
}

/** Render loading / error / content for a useAsync state. */
export function Async<T>({ state, children, loadingLabel }: { state: AsyncState<T>; children: (data: T) => ReactNode; loadingLabel?: string }) {
  if (state.loading && state.data == null) return <Loading label={loadingLabel} />;
  if (state.error && state.data == null) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.data == null) return <Loading label={loadingLabel} />;
  return <>{children(state.data)}</>;
}

export function InlineError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="inline-error" role="alert">
      {message}
    </div>
  );
}

export function Banner({ tone = 'info', title, children, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <div className="banner-body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}
