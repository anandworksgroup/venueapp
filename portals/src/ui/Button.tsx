import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './States';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'success';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  pending?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', pending, block, icon, className, children, disabled, type, ...rest }: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, `btn-${size}`, block ? 'btn-block' : '', pending ? 'is-pending' : '', className || ''].filter(Boolean).join(' ');
  return (
    <button type={type || 'button'} className={cls} disabled={disabled || pending} aria-busy={pending || undefined} {...rest}>
      {pending ? <Spinner size={14} /> : icon}
      {children != null && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={`icon-btn ${className || ''}`} {...rest}>
      {children}
    </button>
  );
}
