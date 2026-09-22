import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bizApi, errMsg } from '../api';
import { dateTime } from '../shared/format';
import { useAsync } from '../shared/hooks';
import { Async, Button, Card, EmptyState, InlineError, PageHeader, useToast } from '../ui';
import type { Notification } from '../types';
import { useBiz } from './context';

export function NotificationsPage() {
  const { refreshUnread } = useBiz();
  const state = useAsync(() => bizApi.get<{ unread: number; items: Notification[] }>('/business/notifications'), []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const markAll = async () => {
    setPending(true);
    setError(null);
    try {
      await bizApi.post('/business/notifications/read', {});
      toast('All caught up');
      state.reload();
      refreshUnread();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  };
  const open = async (n: Notification) => {
    if (!n.read_at) {
      bizApi.post('/business/notifications/read', { ids: [n.id] }).then(() => refreshUnread(), () => {});
    }
    const bookingId = n.data?.booking_id as string | undefined;
    if (bookingId) navigate(`/business/bookings/${bookingId}`);
    else if (n.type === 'payout_processed') navigate('/business/finance');
    else if (n.type === 'verification_update') navigate('/business/verification');
    else if (n.type === 'new_review') navigate('/business/reviews');
  };
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={state.data ? `${state.data.unread} unread` : undefined}
        actions={
          <Button variant="secondary" onClick={markAll} pending={pending} disabled={!state.data?.unread}>
            Mark all read
          </Button>
        }
      />
      <InlineError message={error} />
      <Card>
        <Async state={state}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="No notifications" body="Bookings, payments, payouts and verification updates will appear here." />
            ) : (
              <div>
                {d.items.map((n) => (
                  <div key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => open(n)} onKeyDown={(e) => e.key === 'Enter' && open(n)}>
                    <div style={{ flex: 1 }}>
                      <div className="notif-title">{n.title}</div>
                      <div>{n.body}</div>
                      <div className="muted small">{dateTime(n.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </Async>
      </Card>
    </>
  );
}
