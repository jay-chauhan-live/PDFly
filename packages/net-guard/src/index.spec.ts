import { describe, expect, it } from 'vitest';
import { hostMatchesAllowlist, isPrivateAddress, resolvesToPrivateAddress } from './index.js';

describe('isPrivateAddress', () => {
  it('refuses every range PLAN §11 names', () => {
    const blocked = [
      'localhost',
      'api.localhost',
      'db.internal',
      'printer.local',
      'router.home.arpa',
      '0.0.0.0',
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '198.18.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
    ];

    for (const host of blocked) {
      expect(isPrivateAddress(host), host).toBe(true);
    }
  });

  it('allows addresses that only resemble the blocked ranges', () => {
    const allowed = [
      'example.com',
      'localhost.example.com',
      '8.8.8.8',
      '1.1.1.1',
      // Just outside 172.16/12 on either side.
      '172.15.255.255',
      '172.32.0.1',
      '11.0.0.1',
      '192.167.0.1',
      '169.253.0.1',
      '100.63.0.1',
      '100.128.0.1',
      '2606:4700:4700::1111',
    ];

    for (const host of allowed) {
      expect(isPrivateAddress(host), host).toBe(false);
    }
  });

  it('sees through an IPv4-mapped IPv6 literal', () => {
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('ignores the brackets a URL puts around an IPv6 literal', () => {
    expect(isPrivateAddress('[::1]')).toBe(true);
  });

  it('is not fooled by case', () => {
    expect(isPrivateAddress('LOCALHOST')).toBe(true);
    expect(isPrivateAddress('FE80::1')).toBe(true);
  });
});

describe('resolvesToPrivateAddress', () => {
  it('refuses a literal private address without resolving anything', async () => {
    const verdict = await resolvesToPrivateAddress('169.254.169.254');

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/literal/);
  });

  it('allows a public literal', async () => {
    expect((await resolvesToPrivateAddress('8.8.8.8')).allowed).toBe(true);
  });

  it('refuses a name that resolves to loopback', async () => {
    // A name is not a destination: this one is public but points home.
    const verdict = await resolvesToPrivateAddress('localhost');

    expect(verdict.allowed).toBe(false);
  });

  it('refuses a name that does not resolve at all', async () => {
    const verdict = await resolvesToPrivateAddress('this-name-does-not-exist.pdfly-test.invalid');

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/resolve/);
  });
});

describe('hostMatchesAllowlist', () => {
  it('permits everything when the list is empty', () => {
    expect(hostMatchesAllowlist('anything.example.com', [])).toBe(true);
  });

  it('matches a host and its subdomains, not a lookalike suffix', () => {
    expect(hostMatchesAllowlist('cdn.example.com', ['example.com'])).toBe(true);
    expect(hostMatchesAllowlist('example.com', ['example.com'])).toBe(true);

    // The check that stops `notexample.com` passing as `example.com`.
    expect(hostMatchesAllowlist('notexample.com', ['example.com'])).toBe(false);
    expect(hostMatchesAllowlist('example.com.evil.test', ['example.com'])).toBe(false);
  });

  it('tolerates a leading dot and any casing in the list', () => {
    expect(hostMatchesAllowlist('CDN.Example.com', ['.EXAMPLE.com'])).toBe(true);
  });
});
