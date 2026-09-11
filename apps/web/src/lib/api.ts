const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Every route that returns the signed-in user returns exactly this. */
export interface ApiUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: string;
  themePref: 'system' | 'light' | 'dark';
  emailVerified: boolean;
  org: { id: string; name: string; slug: string; plan: string };
}

/** RFC 7807 problem+json, as the api emits it (PLAN §6). */
export interface ProblemBody {
  code: string;
  detail: string;
  status: number;
  errors?: string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The access token lives in module scope, never in localStorage: anything
 * readable by script is readable by injected script. Reloads recover the
 * session from the httpOnly refresh cookie instead.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function toError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ProblemBody | null;

  return new ApiError(
    response.status,
    body?.code ?? 'internal_error',
    body?.detail ?? response.statusText,
    Array.isArray(body?.errors) ? body.errors : undefined,
  );
}

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    // Required for the refresh cookie to travel to the api origin.
    credentials: 'include',
  });
}

type Session = { accessToken: string; user: ApiUser };

/**
 * Callers share one in-flight refresh.
 *
 * Refresh tokens rotate and are single-use, so two simultaneous exchanges of
 * the same cookie look exactly like a replayed token — which the api answers
 * by revoking the session family. Without this, a mount effect racing a 401
 * retry (or React's double-invoked effects in development) would sign the
 * user out. The api tolerates a genuine cross-tab race separately; this
 * removes the ones we cause ourselves.
 */
let inFlightRefresh: Promise<Session | null> | null = null;

/** Exchanges the refresh cookie for a new access token. */
export function refreshSession(): Promise<Session | null> {
  inFlightRefresh ??= exchangeRefreshCookie().finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

async function exchangeRefreshCookie(): Promise<Session | null> {
  const response = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    accessToken = null;
    return null;
  }

  const data = (await response.json()) as Session;
  accessToken = data.accessToken;
  return data;
}

/**
 * Authenticated request. A 401 triggers exactly one refresh-and-retry — more
 * than one would loop when the session is genuinely gone.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await rawFetch(path, init);

  if (response.status === 401 && accessToken) {
    const refreshed = await refreshSession();
    if (refreshed) response = await rawFetch(path, init);
  }

  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export const API_BASE = API_URL;
