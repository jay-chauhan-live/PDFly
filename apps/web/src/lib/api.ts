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
  const response = await authedFetch(path, init);

  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/** The same request, for endpoints that answer with a PDF rather than JSON. */
export async function apiBlob(
  path: string,
  init: RequestInit = {},
): Promise<{ blob: Blob; headers: Headers }> {
  const response = await authedFetch(path, init);

  if (!response.ok) throw await toError(response);

  return { blob: await response.blob(), headers: response.headers };
}

async function authedFetch(path: string, init: RequestInit): Promise<Response> {
  let response = await rawFetch(path, init);

  if (response.status === 401 && accessToken) {
    const refreshed = await refreshSession();
    if (refreshed) response = await rawFetch(path, init);
  }

  return response;
}

// ---------------------------------------------------------------------------
// Rendering and documents
// ---------------------------------------------------------------------------

export const PAGE_FORMATS = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid', 'Ledger'] as const;

export type PageFormat = (typeof PAGE_FORMATS)[number];

export const WAIT_UNTIL = ['load', 'domcontentloaded', 'networkidle', 'commit'] as const;

/** Mirrors RenderOptionsDto on the api. */
export interface RenderOptions {
  format?: PageFormat;
  landscape?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  printBackground?: boolean;
  scale?: number;
  headerTemplate?: string;
  footerTemplate?: string;
  waitUntil?: (typeof WAIT_UNTIL)[number];
  timeoutMs?: number;
  javascript?: boolean;
}

export interface RenderRequest {
  html: string;
  options?: RenderOptions;
  title?: string;
  filename?: string;
  output?: 'url' | 'binary' | 'base64';
}

export type DocumentStatus = 'queued' | 'rendering' | 'completed' | 'failed' | 'expired';
export type DocumentSource = 'api' | 'ui';

export interface DocumentSummary {
  id: string;
  title: string | null;
  status: DocumentStatus;
  source: DocumentSource;
  pageCount: number | null;
  byteSize: number | null;
  durationMs: number | null;
  errorCode: string | null;
  createdAt: string;
  expiresAt: string | null;
  creator: { id: string; name: string; email: string } | null;
}

export interface DocumentDetail extends DocumentSummary {
  optionsJson: RenderOptions | null;
  errorMessage: string | null;
  isEncrypted: boolean;
  hasWatermark: boolean;
}

export interface DocumentPage {
  data: DocumentSummary[];
  nextCursor?: string;
}

export interface DocumentFilters {
  search?: string;
  status?: DocumentStatus;
  source?: DocumentSource;
  limit?: number;
  cursor?: string;
}

export function listDocuments(filters: DocumentFilters = {}): Promise<DocumentPage> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    // An empty search box is no filter at all, not a search for "".
    if (value !== undefined && value !== '') params.set(key, String(value));
  }

  const query = params.toString();
  return api<DocumentPage>(`/v1/documents${query ? `?${query}` : ''}`);
}

export function getDocument(id: string): Promise<DocumentDetail> {
  return api<DocumentDetail>(`/v1/documents/${id}`);
}

export function documentDownload(id: string): Promise<{ url: string; filename: string }> {
  return api<{ url: string; filename: string }>(`/v1/documents/${id}/file`);
}

export function deleteDocument(id: string): Promise<void> {
  return api<void>(`/v1/documents/${id}`, { method: 'DELETE' });
}

export interface RenderResult {
  id: string;
  pageCount: number;
  byteSize: number;
  durationMs: number;
  filename: string;
  url: string;
}

/** A render that is kept: it lands in the documents list. */
export function renderDocument(request: RenderRequest): Promise<RenderResult> {
  return api<RenderResult>('/v1/pdf', { method: 'POST', body: JSON.stringify(request) });
}

// ---------------------------------------------------------------------------
// API tokens
// ---------------------------------------------------------------------------

export const TOKEN_SCOPES = ['pdf:render', 'documents:read', 'documents:delete'] as const;

export type TokenScope = (typeof TOKEN_SCOPES)[number];

export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  /** Enough to recognise, nothing to replay. */
  masked: string;
  scopes: TokenScope[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  creator: { id: string; name: string; email: string } | null;
}

/** The only response that ever carries the secret (PLAN §5). */
export interface MintedApiToken extends ApiTokenSummary {
  token: string;
}

export function listTokens(): Promise<ApiTokenSummary[]> {
  return api<ApiTokenSummary[]>('/v1/tokens');
}

export function createToken(input: {
  name: string;
  scopes: TokenScope[];
  expiresAt?: string;
}): Promise<MintedApiToken> {
  return api<MintedApiToken>('/v1/tokens', { method: 'POST', body: JSON.stringify(input) });
}

export function revokeToken(id: string): Promise<ApiTokenSummary> {
  return api<ApiTokenSummary>(`/v1/tokens/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface UsageTotals {
  renders: number;
  pages: number;
  bytes: number;
  failures: number;
}

export interface UsageDay extends UsageTotals {
  date: string;
}

export interface UsageResponse {
  today: UsageDay;
  month: UsageTotals;
  period: UsageTotals;
  daily: UsageDay[];
  performance: {
    total: number;
    failed: number;
    /** Null when nothing has been rendered today. */
    successRate: number | null;
    p50DurationMs: number | null;
    p95DurationMs: number | null;
  };
}

export function getUsage(days = 30): Promise<UsageResponse> {
  return api<UsageResponse>(`/v1/usage?days=${days}`);
}

export interface PreviewResult {
  blob: Blob;
  pageCount: number;
  durationMs: number;
}

/** A draft render for the live pane: nothing is recorded or stored. */
export async function previewPdf(
  request: RenderRequest,
  signal?: AbortSignal,
): Promise<PreviewResult> {
  const { blob, headers } = await apiBlob('/v1/pdf/preview', {
    method: 'POST',
    body: JSON.stringify(request),
    ...(signal ? { signal } : {}),
  });

  return {
    blob,
    pageCount: Number(headers.get('x-page-count') ?? 0),
    durationMs: Number(headers.get('x-duration-ms') ?? 0),
  };
}

export const API_BASE = API_URL;
