import { createContext, useContext } from 'react';
import type { BusinessMe } from '../types';

export interface BizCtx {
  me: BusinessMe;
  reloadMe: () => Promise<BusinessMe | null>;
  unread: number;
  refreshUnread: () => void;
  logout: () => void;
}

export const BizContext = createContext<BizCtx | null>(null);

export function useBiz() {
  const c = useContext(BizContext);
  if (!c) throw new Error('useBiz outside BizContext');
  return c;
}

export const needsOnboarding = (me: BusinessMe) => !me.business || ['DRAFT', 'REJECTED'].includes(me.business.status);
