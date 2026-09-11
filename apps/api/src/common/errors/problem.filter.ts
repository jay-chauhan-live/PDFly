import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProblemError, type ProblemCode } from './problem.js';

const STATUS_TO_CODE: Record<number, ProblemCode> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'rate_limited',
  503: 'service_unavailable',
};

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, code, detail, extra } = this.normalise(exception);

    if (status >= 500) {
      this.logger.error({ err: exception }, 'unhandled error');
    }

    response
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://docs.pdfly.dev/errors/${code}`,
        title: code.replace(/_/g, ' '),
        status,
        code,
        detail,
        instance: request.originalUrl,
        ...extra,
      });
  }

  private normalise(exception: unknown): {
    status: number;
    code: ProblemCode;
    detail: string;
    extra: Record<string, unknown>;
  } {
    if (exception instanceof ProblemError) {
      return {
        status: exception.status,
        code: exception.code,
        detail: exception.detail,
        extra: exception.extra,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      return {
        status,
        code: STATUS_TO_CODE[status] ?? 'internal_error',
        detail: exception.message,
        extra: this.extraFrom(exception.getResponse()),
      };
    }

    return {
      status: 500,
      code: 'internal_error',
      // Never leak an internal message to the client.
      detail: 'An unexpected error occurred',
      extra: {},
    };
  }

  /** Detail worth forwarding from a framework exception's body, and nothing else. */
  private extraFrom(body: unknown): Record<string, unknown> {
    if (typeof body !== 'object' || body === null) return {};

    // class-validator failures arrive as { message: string[] }.
    const { message } = body as { message?: unknown };
    if (Array.isArray(message)) return { errors: message as string[] };

    // Terminus names the dependency that failed. Collapsing that into a bare
    // 503 leaves an operator with nothing to act on, so it is carried through.
    if ('details' in body) {
      const { info, error, details } = body as Record<string, unknown>;
      return { info, error, details };
    }

    return {};
  }
}
