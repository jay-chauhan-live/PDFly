import { SetMetadata } from '@nestjs/common';

/** PLAN §5. A token carries a subset; a dashboard session carries all of them. */
export const SCOPES = ['pdf:render', 'documents:read', 'documents:delete'] as const;

export type Scope = (typeof SCOPES)[number];

export const ALL_SCOPES: Scope[] = [...SCOPES];

export const REQUIRED_SCOPES = 'auth:scopes';

/**
 * Declares what a route needs. Absent, a route needs only a valid credential
 * — which is right for reading your own profile, and wrong for anything that
 * spends money or destroys data.
 */
export const RequireScopes = (...scopes: Scope[]) => SetMetadata(REQUIRED_SCOPES, scopes);

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}
