import { describe, expect, it } from 'vitest';
import {
  hashToken,
  maskedToken,
  mintToken,
  parseTokenPrefix,
  tokensMatch,
  TOKEN_PREFIX_LENGTH,
} from './token.format.js';

/** Everything after the prefix, which is where the '_' hazard lives. */
const secretOf = (token: string) => token.slice(token.indexOf('_', 'pdfly_live_'.length) + 1);

describe('mintToken', () => {
  it('produces pdfly_live_<prefix>_<secret> (PLAN §5)', () => {
    const { token, prefix } = mintToken();
    expect(token.startsWith(`pdfly_live_${prefix}_`)).toBe(true);
    expect(prefix).toHaveLength(TOKEN_PREFIX_LENGTH);
    // 32 bytes of entropy, base64url — which may itself contain '_'.
    expect(secretOf(token)).toHaveLength(43);
  });

  it('returns the digest of the whole token, never the secret', () => {
    const { token, hash } = mintToken();
    const secret = secretOf(token);

    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not repeat itself', () => {
    const prefixes = new Set(Array.from({ length: 200 }, () => mintToken().prefix));

    expect(prefixes.size).toBe(200);
  });

  it('uses only lowercase alphanumerics in the prefix, so it survives a URL or a log', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(mintToken().prefix).toMatch(/^[a-z0-9]+$/);
    }
  });
});

describe('parseTokenPrefix', () => {
  it('extracts the prefix from a well-formed token', () => {
    const { token, prefix } = mintToken();

    expect(parseTokenPrefix(token)).toBe(prefix);
  });

  it('refuses anything that is not one of ours, without throwing', () => {
    const rejected = [
      '',
      'not-a-token',
      'pdfly_live_short_secret',
      'pdfly_test_abcd1234_secret',
      'other_live_abcd1234_secret',
      'pdfly_live_abcd1234',
      'pdfly_live_abcd1234_',
      'pdfly_live_ABCD1234_secret',
      'pdfly_live_abcd1234_has spaces',
      // A JWT, which the guard routes elsewhere but must not crash here.
      'eyJhbGciOi.eyJzdWIi.c2ln',
    ];

    for (const value of rejected) {
      expect(parseTokenPrefix(value), value).toBeNull();
    }
  });

  it('accepts a secret containing the separator, which base64url produces', () => {
    // Roughly half of all secrets contain '_' or '-'. Counting '_'-separated
    // segments would reject those tokens at random.
    expect(parseTokenPrefix('pdfly_live_abcd1234_aa_bb-cc_dd')).toBe('abcd1234');
  });
});

describe('tokensMatch', () => {
  it('accepts identical digests and rejects different ones', () => {
    const a = hashToken('pdfly_live_aaaaaaaa_one');
    const b = hashToken('pdfly_live_bbbbbbbb_two');

    expect(tokensMatch(a, a)).toBe(true);
    expect(tokensMatch(a, b)).toBe(false);
  });

  it('rejects malformed or empty stored hashes rather than throwing', () => {
    const valid = hashToken('pdfly_live_aaaaaaaa_one');

    expect(tokensMatch(valid, '')).toBe(false);
    expect(tokensMatch('', '')).toBe(false);
    expect(tokensMatch(valid, 'deadbeef')).toBe(false);
  });
});

describe('maskedToken', () => {
  it('shows enough to recognise and nothing to replay', () => {
    const { token, prefix } = mintToken();
    const masked = maskedToken(prefix);
    const secret = secretOf(token);

    expect(masked).toContain(prefix);
    expect(masked).not.toContain(secret);
  });
});
