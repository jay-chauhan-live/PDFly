import type { RequestContext } from '../auth/request-context.js';
import type { RenderAttribution } from './render.pipeline.js';

/**
 * A dashboard session carries a user; an API token does not. That is the only
 * honest signal for `source`, and it cannot be spoofed by the request body.
 *
 * Shared by the synchronous and async entry points so the two cannot drift.
 */
export function attributionFor(ctx: RequestContext): RenderAttribution {
  return {
    orgId: ctx.orgId,
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    source: ctx.userId ? 'ui' : 'api',
  };
}
