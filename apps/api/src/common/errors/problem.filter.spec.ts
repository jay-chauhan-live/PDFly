import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ProblemError } from './problem.js';
import { ProblemExceptionFilter } from './problem.filter.js';

interface Captured {
  status: number;
  type: string;
  body: Record<string, unknown>;
}

function capture(exception: unknown, url = '/v1/pdf'): Captured {
  const captured = {} as Captured;

  const response = {
    status(value: number) {
      captured.status = value;
      return this;
    },
    type(value: string) {
      captured.type = value;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ originalUrl: url }),
    }),
  } as unknown as ArgumentsHost;

  const filter = new ProblemExceptionFilter();

  // A 500 logs its cause, which is only noise in test output.
  Object.assign(filter, { logger: { error: () => undefined } });
  filter.catch(exception, host);

  return captured;
}

describe('ProblemExceptionFilter', () => {
  it('emits problem+json with the stable code as the contract (PLAN §6)', () => {
    const { status, type, body } = capture(
      new ProblemError('render_timeout', 504, 'Rendering took too long'),
    );

    expect(status).toBe(504);
    expect(type).toBe('application/problem+json');
    expect(body).toMatchObject({
      type: 'https://docs.pdfly.dev/errors/render_timeout',
      title: 'render timeout',
      code: 'render_timeout',
      detail: 'Rendering took too long',
      instance: '/v1/pdf',
    });
  });

  it('carries a ProblemError’s extra fields through', () => {
    const { body } = capture(
      new ProblemError('payload_too_large', 413, 'Too much markup', { limitBytes: 5_242_880 }),
    );

    expect(body.limitBytes).toBe(5_242_880);
  });

  it('surfaces class-validator messages as `errors`', () => {
    const { status, body } = capture(new BadRequestException(['password is too short']));

    expect(status).toBe(400);
    expect(body.code).toBe('invalid_request');
    expect(body.errors).toEqual(['password is too short']);
  });

  it('names the dependency that failed a health check', () => {
    // The shape @nestjs/terminus throws when an indicator reports down.
    const { status, body } = capture(
      new ServiceUnavailableException({
        status: 'error',
        info: { postgres: { status: 'up' } },
        error: { renderer: { status: 'down' } },
        details: { postgres: { status: 'up' }, renderer: { status: 'down' } },
      }),
      '/health',
    );

    expect(status).toBe(503);
    expect(body.code).toBe('service_unavailable');
    // A bare 503 leaves an operator with nothing to act on.
    expect(body.error).toEqual({ renderer: { status: 'down' } });
    expect(body.details).toMatchObject({ renderer: { status: 'down' } });
  });

  it('adds no extra fields for an exception carrying only a string message', () => {
    const { body } = capture(new HttpException('Nope', 418));

    expect(body.errors).toBeUndefined();
    expect(body.details).toBeUndefined();
    expect(body.code).toBe('internal_error');
  });

  it('never leaks the message of an unexpected error', () => {
    const { status, body } = capture(new Error('connection string: postgres://user:secret@db'));

    expect(status).toBe(500);
    expect(body.detail).toBe('An unexpected error occurred');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
