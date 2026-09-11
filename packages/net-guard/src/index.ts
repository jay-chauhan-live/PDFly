import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Which addresses this service must never be made to connect to (PLAN §11).
 *
 * Two places need exactly these rules and must not drift apart: the api,
 * deciding whether a customer's webhook URL is deliverable, and the renderer,
 * deciding whether Chromium may fetch an asset. The second is the one that
 * matters most — it is executing attacker-supplied markup — but the first
 * runs in the process holding the database credentials.
 */

/** Ranges that are never a legitimate destination for user-supplied content. */
const V4_RANGES: { name: string; test: (octets: number[]) => boolean }[] = [
  { name: 'this-network', test: (o) => o[0] === 0 },
  { name: 'loopback', test: (o) => o[0] === 127 },
  { name: 'private', test: (o) => o[0] === 10 },
  { name: 'private', test: (o) => o[0] === 172 && (o[1] ?? 0) >= 16 && (o[1] ?? 0) <= 31 },
  { name: 'private', test: (o) => o[0] === 192 && o[1] === 168 },
  // 169.254.169.254 lives here: the cloud metadata endpoint, and the single
  // most valuable target an SSRF has.
  { name: 'link-local', test: (o) => o[0] === 169 && o[1] === 254 },
  {
    name: 'carrier-grade-nat',
    test: (o) => o[0] === 100 && (o[1] ?? 0) >= 64 && (o[1] ?? 0) <= 127,
  },
  { name: 'benchmark', test: (o) => o[0] === 198 && (o[1] === 18 || o[1] === 19) },
  { name: 'reserved', test: (o) => (o[0] ?? 0) >= 240 },
  { name: 'broadcast', test: (o) => o.join('.') === '255.255.255.255' },
];

const PRIVATE_SUFFIXES = ['.localhost', '.internal', '.local', '.home.arpa'];

/** True when a literal address or an obviously-internal name must be refused. */
export function isPrivateAddress(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\[|]$/g, '');

  if (lower === 'localhost' || PRIVATE_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return true;
  }

  const version = isIP(lower);

  if (version === 4) {
    const octets = lower.split('.').map(Number);
    return V4_RANGES.some((range) => range.test(octets));
  }

  if (version === 6) {
    // An IPv4-mapped address reaches the same v4 target through a v6 literal.
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice('::ffff:'.length));

    return (
      lower === '::' ||
      lower === '::1' ||
      // fc00::/7 unique-local, fe80::/10 link-local.
      /^f[cd]/.test(lower) ||
      /^fe[89ab]/.test(lower)
    );
  }

  return false;
}

export interface ResolutionVerdict {
  allowed: boolean;
  /** Populated when refused, for a log line that explains itself. */
  reason?: string;
  addresses: string[];
}

/**
 * Resolves a hostname and refuses it if *any* answer is private.
 *
 * A name is not a destination. `evil.example.com` can have an A record
 * pointing at 169.254.169.254, and checking the name alone would wave it
 * through. Every address the resolver returns is checked, because a
 * round-robin record that mixes a public and a private answer would otherwise
 * pass whenever the public one happened to come first.
 *
 * This is not a complete defence against DNS rebinding: the resolver can
 * return a public address here and a private one when the client connects a
 * moment later. Closing that needs the connection itself pinned to the
 * address that was checked, which is what an egress proxy does.
 */
export async function resolvesToPrivateAddress(hostname: string): Promise<ResolutionVerdict> {
  if (isPrivateAddress(hostname)) {
    return { allowed: false, reason: 'literal private address', addresses: [hostname] };
  }

  // Already an IP literal and not private: nothing to resolve.
  if (isIP(hostname) !== 0) return { allowed: true, addresses: [hostname] };

  let answers: { address: string }[];

  try {
    answers = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    // A name that does not resolve cannot be fetched anyway; refusing here
    // keeps the failure on the policy side where it is explainable.
    return { allowed: false, reason: 'hostname does not resolve', addresses: [] };
  }

  const addresses = answers.map((answer) => answer.address);

  if (addresses.length === 0) {
    return { allowed: false, reason: 'hostname resolved to nothing', addresses };
  }

  const offending = addresses.find((address) => isPrivateAddress(address));

  if (offending !== undefined) {
    return { allowed: false, reason: `resolves to ${offending}`, addresses };
  }

  return { allowed: true, addresses };
}

/** Hostnames an allowlist permits. Empty means "no host restriction". */
export function hostMatchesAllowlist(hostname: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;

  const lower = hostname.toLowerCase();

  return allowlist.some((entry) => {
    const candidate = entry.toLowerCase().replace(/^\./, '');
    return lower === candidate || lower.endsWith(`.${candidate}`);
  });
}
