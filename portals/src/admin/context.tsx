import { createContext, useContext } from 'react';
import type { User } from '../types';

export interface AdminCtx {
  user: User;
  permissions: string[];
  can: (perm: string) => boolean;
  logout: () => void;
}

export const AdminContext = createContext<AdminCtx | null>(null);

export function useAdmin() {
  const c = useContext(AdminContext);
  if (!c) throw new Error('useAdmin outside AdminContext');
  return c;
}
