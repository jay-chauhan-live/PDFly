import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WebhookService } from './webhook.service.js';
import { assertDeliverableUrl, isPrivateHost } from './webhook.url.js';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';

const SECRET = 'a-webhook-signing-secret-for-tests';

const service = new WebhookService(
  {} as unknown as PrismaService,
  {
    get: () => SECRET,
  } as unknown as ConfigService<never, true>,
);

describe('webhook signatures', () => {
  it('signs the timestamp together with the body', () => {
    const body = JSON.stringify({ event: 'document.completed', documentId: 'abc' });
    const timestamp = 1_700_000_000;

    // What a receiver implements from the docs, written out in full so the
    // contract is pinned rather than described.
    const expected = `v1=${createHmac('sha256', SECRET)
      .update(`${timestamp}.${body}`)
      .digest('hex')}`;

    expect(service.sign(timestamp, body)).toBe(expected);
  });

  it('verifies its own signature', () => {
    const body = '{"event":"document.completed"}';

    expect(service.verify(1_700_000_000, body, service.sign(1_700_000_000, body))).toBe(true);
  });

  it('rejects a body that was altered after signing', () => {
    const signature = service.sign(1_700_000_000, '{"amount":10}');

    expect(service.verify(1_700_000_000, '{"amount":1000}', signature)).toBe(false);
  });

  it('rejects a replay under a different timestamp', () => {
    // Signing the body alone would make a captured request valid forever.
    const body = '{"event":"document.completed"}';
    const signature = service.sign(1_700_000_000, body);

    expect(service.verify(1_700_000_060, body, signature)).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    expect(service.verify(1, 'body', 'v1=short')).toBe(false);
    expect(service.verify(1, 'body', '')).toBe(false);
  });
});

describe('isPrivateHost', () => {
  it('catches the ranges PLAN §11 names', () => {
    const blocked = [
      'localhost',
      'api.localhost',
      'db.internal',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      // The cloud metadata endpoint, which is the whole reason this exists.
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
    ];

    for (const host of blocked) {
      expect(isPrivateHost(host), host).toBe(true);
    }
  });

  it('does not block addresses that merely look similar', () => {
    const allowed = [
      'example.com',
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '11.0.0.1',
      '2606:4700::1',
    ];

    for (const host of allowed) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });

  it('sees through an IPv4-mapped IPv6 literal', () => {
    // ::ffff:169.254.169.254 reaches the metadata endpoint just as well.
    expect(isPrivateHost('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateHost('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('assertDeliverableUrl', () => {
  const strict = { allowPrivate: false };

  it('accepts an ordinary https endpoint', () => {
    expect(assertDeliverableUrl('https://example.com/hooks/pdfly', strict).host).toBe(
      'example.com',
    );
  });

  it('refuses a private destination', () => {
    expect(() => assertDeliverableUrl('https://169.254.169.254/latest/meta-data', strict)).toThrow(
      /private or loopback/,
    );
    expect(() => assertDeliverableUrl('https://localhost:9000/hook', strict)).toThrow();
  });

  it('refuses plaintext http outside development', () => {
    expect(() => assertDeliverableUrl('http://example.com/hook', strict)).toThrow(/https/);
  });

  it('refuses a scheme that is not http at all', () => {
    expect(() => assertDeliverableUrl('file:///etc/passwd', strict)).toThrow();
    expect(() => assertDeliverableUrl('gopher://example.com', strict)).toThrow();
  });

  it('refuses something that is not a URL', () => {
    expect(() => assertDeliverableUrl('not a url', strict)).toThrow(/valid URL/);
  });

  it('lets development point at localhost', () => {
    expect(assertDeliverableUrl('http://localhost:4000/hook', { allowPrivate: true }).port).toBe(
      '4000',
    );
  });
});
