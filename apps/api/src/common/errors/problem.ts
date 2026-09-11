/**
 * RFC 7807 problem+json with a stable machine-readable `code` (PLAN §6).
 * The code is the contract; the human-readable detail is not.
 */
export type ProblemCode =
  | 'invalid_request'
  | 'invalid_html'
  | 'render_timeout'
  | 'asset_blocked'
  | 'payload_too_large'
  | 'quota_exceeded'
  | 'renderer_unavailable'
  | 'unauthorized'
  | 'not_found'
  | 'internal_error';

export class ProblemError extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly status: number,
    readonly detail: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(detail);
    this.name = 'ProblemError';
  }
}
