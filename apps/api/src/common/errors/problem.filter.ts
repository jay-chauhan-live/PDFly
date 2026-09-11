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
  404: 'not_found',
  413: 'payload_too_large',
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
      const body = exception.getResponse();

      // class-validator failures arrive as { message: string[] }.
      const extra =
        typeof body === 'object' && body !== null && 'message' in body
          ? { errors: (body as { message: unknown }).message }
          : {};

      return {
        status,
        code: STATUS_TO_CODE[status] ?? 'internal_error',
        detail: exception.message,
        extra,
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
}
