/**
 * What every authenticated request resolves to, regardless of whether it
 * arrived with a session cookie or an API token (PLAN §5). Downstream code
 * must never care which.
 */
export interface RequestContext {
  orgId: string;
  userId?: string;
  tokenId?: string;
  scopes: string[];
}

declare module 'express' {
  interface Request {
    ctx?: RequestContext;
  }
}
