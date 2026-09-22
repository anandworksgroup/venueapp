import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { InlineError } from './States';

export function Card({ title, subtitle, actions, children, className, pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${pad ? 'card-pad' : ''} ${className || ''}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {back}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'teal';

export function Pill({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, tone, icon }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'teal' | 'accent' | 'success' | 'warning' | 'danger'; icon?: ReactNode }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

// Stack of open overlays so Escape closes only the topmost one.
const overlayStack: number[] = [];
let overlaySeq = 0;

function useEscape(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = ++overlaySeq;
    overlayStack.push(id);
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && overlayStack[overlayStack.length - 1] === id) {
        e.stopImmediatePropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', on);
    const cleanupStack = () => {
      const i = overlayStack.indexOf(id);
      if (i >= 0) overlayStack.splice(i, 1);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', on);
      cleanupStack();
      document.body.style.overflow = prev;
    };
  }, [open]);
}

export function Modal({ open, onClose, title, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: width }}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="overlay overlay-drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" style={{ maxWidth: width }}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Confirmation dialog for destructive or irreversible actions. When
 * `reasonLabel` is set a reason is collected (and required unless
 * `reasonOptional`). onConfirm may throw; the message is shown inline.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  reasonLabel,
  reasonOptional,
  reasonPlaceholder,
  extra,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  reasonLabel?: string;
  reasonOptional?: boolean;
  reasonPlaceholder?: string;
  extra?: ReactNode;
  onConfirm: (reason: string) => Promise<unknown> | unknown;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
      setPending(false);
      setTimeout(() => ref.current?.focus(), 30);
    }
  }, [open]);
  const needReason = Boolean(reasonLabel) && !reasonOptional;
  const submit = async () => {
    if (needReason && !reason.trim()) {
      setError(`${reasonLabel} is required`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => !pending && onClose()}
      title={title}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Go back
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} pending={pending} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <div className="confirm-msg">{message}</div>}
      {extra}
      {reasonLabel && (
        <label className="field">
          <span className="field-label">
            {reasonLabel}
            {reasonOptional && <em className="muted"> (optional)</em>}
          </span>
          <textarea ref={ref} className="input" rows={3} value={reason} placeholder={reasonPlaceholder} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
      )}
      <InlineError message={error} />
    </Modal>
  );
}

export function Tabs<K extends string>({ items, value, onChange }: { items: { key: K; label: ReactNode; count?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button key={t.key} role="tab" type="button" aria-selected={t.key === value} className={`tab ${t.key === value ? 'is-active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Chips<K extends string>({ items, value, onChange }: { items: { key: K; label: ReactNode; count?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="chips">
      {items.map((t) => (
        <button key={t.key} type="button" className={`chip ${t.key === value ? 'is-active' : ''}`} aria-pressed={t.key === value} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count != null && <span className="chip-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} className="kv-row">
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
