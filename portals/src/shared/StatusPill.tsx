import { Pill, type Tone } from '../ui';
import { titleCase } from './format';

const TONES: Record<string, Tone> = {
  CONFIRMED: 'success',
  APPROVED: 'success',
  PUBLISHED: 'success',
  COMPLETED: 'success',
  VERIFIED: 'success',
  CAPTURED: 'success',
  PROCESSED: 'success',
  PAID: 'success',
  RESOLVED: 'success',
  ACTIVE: 'success',
  DOCUMENTS_VERIFIED: 'teal',
  UPCOMING: 'teal',
  REQUESTED: 'warning',
  PENDING_PAYMENT: 'warning',
  PAYMENT_PROCESSING: 'warning',
  SUBMITTED: 'warning',
  UNDER_REVIEW: 'warning',
  PENDING: 'warning',
  PROCESSING: 'warning',
  IN_REVIEW: 'warning',
  OPEN: 'warning',
  CANCELLATION_REQUESTED: 'warning',
  REFUND_PROCESSING: 'warning',
  IN_PAYOUT: 'info',
  ELIGIBLE: 'info',
  CREATED: 'neutral',
  REFUNDED: 'info',
  CANCELLED: 'danger',
  REJECTED: 'danger',
  FAILED: 'danger',
  PAYMENT_FAILED: 'danger',
  SUSPENDED: 'danger',
  BLOCKED: 'danger',
  HIDDEN: 'danger',
  DRAFT: 'neutral',
  EXPIRED: 'neutral',
  ARCHIVED: 'neutral',
  NOT_ELIGIBLE: 'neutral',
};

const LABELS: Record<string, string> = {
  REQUESTED: 'Awaiting you',
  PENDING_PAYMENT: 'Payment pending',
  DOCUMENTS_VERIFIED: 'Docs verified',
  NOT_ELIGIBLE: 'Held until event',
  REJECTED: 'Rejected',
};

export function StatusPill({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <Pill>—</Pill>;
  return (
    <Pill tone={TONES[status] || 'neutral'} title={status}>
      <span className="pill-dot" aria-hidden="true" />
      {label || LABELS[status] || titleCase(status)}
    </Pill>
  );
}

export function statusTone(status: string): Tone {
  return TONES[status] || 'neutral';
}
