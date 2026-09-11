import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ProblemError } from '../common/errors/problem.js';
import type { RequestContext } from './request-context.js';

/** Injects the resolved `{ orgId, userId?, tokenId?, scopes }` (PLAN §5). */
export const CurrentContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext => {
    const request = context.switchToHttp().getRequest<Request>();

    if (!request.ctx) {
      throw new ProblemError('unauthorized', 401, 'Missing request context');
    }

    return request.ctx;
  },
);
