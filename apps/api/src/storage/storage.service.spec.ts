import { describe, expect, it } from 'vitest';
import { StorageService } from './storage.service.js';
import type { ConfigService } from '@nestjs/config';

function configWith(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    S3_BUCKET: 'pdfly-files',
    DOWNLOAD_URL_TTL_SECONDS: 900,
    S3_REGION: 'auto',
    S3_ENDPOINT: 'http://minio:9000',
    S3_FORCE_PATH_STYLE: true,
    S3_ACCESS_KEY_ID: 'id',
    S3_SECRET_ACCESS_KEY: 'secret',
    ...overrides,
  };

  return { get: (key: string) => base[key] } as unknown as ConfigService<never, true>;
}

describe('StorageService', () => {
  it('lays objects out per org, as PLAN §3.5 specifies', () => {
    const service = new StorageService(configWith());

    expect(service.buildKey('org-1', 'doc-1')).toBe('org/org-1/doc-1.pdf');
  });

  it('keeps one tenant’s prefix distinct from another’s', () => {
    const service = new StorageService(configWith());

    expect(service.buildKey('a', 'doc')).not.toBe(service.buildKey('b', 'doc'));
  });

  it('signs download URLs against the public endpoint, not the internal one', async () => {
    // The browser reaches storage through the reverse proxy, so the signature
    // must be computed for that host or MinIO behind it rejects the request.
    const service = new StorageService(
      configWith({ S3_PUBLIC_ENDPOINT: 'https://pdfly.example.com' }),
    );

    const url = await service.signedDownloadUrl('org/a/doc.pdf', 'doc.pdf');

    expect(url).toContain('https://pdfly.example.com/pdfly-files/org/a/doc.pdf');
    expect(url).not.toContain('minio:9000');
    expect(url).toContain('X-Amz-Signature=');
  });

  it('falls back to the single endpoint when no public one is set', async () => {
    const service = new StorageService(configWith());

    const url = await service.signedDownloadUrl('org/a/doc.pdf');

    // Dev and direct-to-R2 keep signing against the only endpoint they have.
    expect(url).toContain('http://minio:9000/pdfly-files/org/a/doc.pdf');
  });
});
