import { describe, expect, it } from 'vitest';
import { StorageService } from './storage.service.js';
import type { ConfigService } from '@nestjs/config';

const config = {
  get: (key: string) =>
    ({
      S3_BUCKET: 'pdfly',
      DOWNLOAD_URL_TTL_SECONDS: 900,
      S3_REGION: 'auto',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_FORCE_PATH_STYLE: true,
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
    })[key],
} as unknown as ConfigService<never, true>;

describe('StorageService', () => {
  it('lays objects out per org, as PLAN §3.5 specifies', () => {
    const service = new StorageService(config);

    expect(service.buildKey('org-1', 'doc-1')).toBe('org/org-1/doc-1.pdf');
  });

  it('keeps one tenant’s prefix distinct from another’s', () => {
    const service = new StorageService(config);

    expect(service.buildKey('a', 'doc')).not.toBe(service.buildKey('b', 'doc'));
  });
});
