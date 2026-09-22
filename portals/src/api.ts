// Typed fetch client for the Pandal API (/api/v1). Each portal keeps its own
// session token; a 401 on an authenticated call clears that token and tells
// the portal to show its login screen.

export type Portal = 'business' | 'admin';

const TOKEN_KEYS: Record<Portal, string> = {
  business: 'pandal.business.token',
  admin: 'pandal.admin.token',
};

export const tokens = {
  get(portal: Portal): string | null {
    try {
      return window.localStorage.getItem(TOKEN_KEYS[portal]);
    } catch {
      return null;
    }
  },
  set(portal: Portal, token: string) {
    try {
      window.localStorage.setItem(TOKEN_KEYS[portal], token);
    } catch {
      /* storage unavailable: session lasts for this tab only */
    }
    memory[portal] = token;
  },
  clear(portal: Portal) {
    try {
      window.localStorage.removeItem(TOKEN_KEYS[portal]);
    } catch {
      /* ignore */
    }
    memory[portal] = null;
  },
};
// Fallback when localStorage throws (private mode etc.).
const memory: Record<Portal, string | null> = { business: null, admin: null };
const currentToken = (portal: Portal) => tokens.get(portal) ?? memory[portal];

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get forbidden() {
    return this.status === 403;
  }
}

export const UNAUTHORIZED_EVENT = 'pandal:unauthorized';

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(query?: Query) {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request<T>(portal: Portal | null, method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = portal ? currentToken(portal) : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}${qs(query)}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the Pandal server. Check your connection and that the backend is running.');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const e = new ApiError(res.status, err?.code || `HTTP_${res.status}`, err?.message || `Request failed (${res.status})`, err?.details);
    if (res.status === 401 && token && portal) {
      tokens.clear(portal);
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: portal }));
    }
    throw e;
  }
  return data as T;
}

export interface Client {
  get<T>(path: string, query?: Query): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  blob(path: string): Promise<Blob>;
}

export function createClient(portal: Portal | null): Client {
  return {
    get: (path, query) => request(portal, 'GET', path, undefined, query),
    post: (path, body) => request(portal, 'POST', path, body ?? {}),
    put: (path, body) => request(portal, 'PUT', path, body ?? {}),
    del: (path) => request(portal, 'DELETE', path),
    async blob(path) {
      const token = portal ? currentToken(portal) : null;
      const res = await fetch(`/api/v1${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) {
        let msg = `Could not open file (${res.status})`;
        try {
          msg = (await res.json()).error?.message || msg;
        } catch {
          /* not JSON */
        }
        if (res.status === 401 && portal) {
          tokens.clear(portal);
          window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: portal }));
        }
        throw new ApiError(res.status, 'FILE', msg);
      }
      return res.blob();
    },
  };
}

export const publicApi = createClient(null);
export const bizApi = createClient('business');
export const adminApi = createClient('admin');

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e ?? 'Something went wrong'));

/** Read a File as base64 (without the data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}
