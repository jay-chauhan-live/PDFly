import { isIP } from 'node:net';
import { ProblemError } from '../common/errors/problem.js';

/**
 * Address ranges a webhook may never target (PLAN §11).
 *
 * A webhook URL is a caller-supplied address that this server will fetch —
 * the same shape of hole as an SSRF in the renderer, and on the process that
 * does hold database credentials. The blocklist is by CIDR rather than by
 * hostname because a name can be made to resolve anywhere.
 */
const BLOCKED_V4 = [
  { cidr: '0.0.0.0/8', test: (p: number[]) => p[0] === 0 },
  { cidr: '10.0.0.0/8', test: (p: number[]) => p[0] === 10 },
  { cidr: '127.0.0.0/8', test: (p: number[]) => p[0] === 127 },
  { cidr: '169.254.0.0/16', test: (p: number[]) => p[0] === 169 && p[1] === 254 },
  {
    cidr: '172.16.0.0/12',
    test: (p: number[]) => p[0] === 172 && (p[1] ?? 0) >= 16 && (p[1] ?? 0) <= 31,
  },
  { cidr: '192.168.0.0/16', test: (p: number[]) => p[0] === 192 && p[1] === 168 },
  {
    cidr: '100.64.0.0/10',
    test: (p: number[]) => p[0] === 100 && (p[1] ?? 0) >= 64 && (p[1] ?? 0) <= 127,
  },
];

export interface WebhookUrlPolicy {
  /** Development points webhooks at localhost; production must not. */
  allowPrivate: boolean;
}

/**
 * Validates a destination at the point it is accepted, so a caller learns
 * their URL is unusable when they submit it rather than from a webhook that
 * silently never arrives.
 *
 * This is a first pass, not the whole defence: a public hostname can still
 * resolve to a private address at delivery time. PLAN §11's egress proxy is
 * what closes that, and it arrives with the rest of the hardening in Phase 7.
 */
export function assertDeliverableUrl(raw: string, policy: WebhookUrlPolicy): URL {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new ProblemError('invalid_request', 400, 'webhookUrl is not a valid URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProblemError('invalid_request', 400, 'webhookUrl must be http or https');
  }

  if (policy.allowPrivate) return url;

  if (url.protocol !== 'https:') {
    throw new ProblemError('invalid_request', 400, 'webhookUrl must use https');
  }

  const host = url.hostname.replace(/^\[|]$/g, '');

  if (isPrivateHost(host)) {
    throw new ProblemError(
      'invalid_request',
      400,
      'webhookUrl must not point at a private or loopback address',
    );
  }

  return url;
}

export function isPrivateHost(host: string): boolean {
  const lower = host.toLowerCase();

  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.internal')) {
    return true;
  }

  const version = isIP(host);

  if (version === 4) {
    const parts = host.split('.').map(Number);
    return BLOCKED_V4.some((range) => range.test(parts));
  }

  if (version === 6) {
    // ::1 loopback, fc00::/7 unique-local, fe80::/10 link-local.
    return (
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') ||
      // IPv4-mapped addresses smuggle a v4 target through a v6 literal.
      (lower.startsWith('::ffff:') && isPrivateHost(lower.slice('::ffff:'.length)))
    );
  }

  return false;
}
