import { date, dateTime, money } from '../shared/format';

export function Money({ value, strong, className }: { value: number | null | undefined; strong?: boolean; className?: string }) {
  const Tag = strong ? 'strong' : 'span';
  return <Tag className={`money ${className || ''}`}>{money(value)}</Tag>;
}

export function DateText({ value, time }: { value: string | null | undefined; time?: boolean }) {
  if (!value) return <span className="muted">—</span>;
  return <time dateTime={value}>{time ? dateTime(value) : date(value)}</time>;
}
