import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * `pdfly_live_<prefix>_<secret>` (PLAN §5, which still spells it `ink_live_`
 * from the project's earlier name).
 *
 * The prefix is a lookup key, not a secret: it is indexed so verification is
 * one indexed read rather than a scan over every token's hash. The secret is
 * 32 bytes of entropy, and only its digest is ever stored.
 */
export const TOKEN_ENVIRONMENT = 'live';
export const TOKEN_PREFIX_LENGTH = 8;

const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export interface MintedToken {
  /** Shown to the caller exactly once, at creation. */
  token: string;
  prefix: string;
  hash: string;
}

export function mintToken(): MintedToken {
  const prefix = randomPrefix();
  const secret = randomBytes(32).toString('base64url');
  const token = `pdfly_${TOKEN_ENVIRONMENT}_${prefix}_${secret}`;

  return { token, prefix, hash: hashToken(token) };
}

/** The whole token is hashed, so a leaked prefix reveals nothing usable. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Splits a presented credential into its prefix, or null when it is not one
 * of ours. Called on every API request, so it stays cheap and total.
 *
 * Anchored rather than split on '_': base64url's alphabet includes '_', so
 * roughly half of all secrets contain the separator. Counting segments would
 * reject those tokens — an authentication failure that appears at random and
 * only for some of the tokens you mint.
 */
const TOKEN_PATTERN = new RegExp(
  `^pdfly_${TOKEN_ENVIRONMENT}_([a-z0-9]{${TOKEN_PREFIX_LENGTH}})_([A-Za-z0-9_-]+)$`,
);

export function parseTokenPrefix(presented: string): string | null {
  return TOKEN_PATTERN.exec(presented)?.[1] ?? null;
}

export function tokensMatch(presentedHash: string, storedHash: string): boolean {
  const left = Buffer.from(presentedHash, 'hex');
  const right = Buffer.from(storedHash, 'hex');

  if (left.length !== right.length || left.length === 0) return false;

  return timingSafeEqual(left, right);
}

/** What the dashboard shows in a list: enough to recognise, useless to replay. */
export function maskedToken(prefix: string): string {
  return `pdfly_${TOKEN_ENVIRONMENT}_${prefix}_${'•'.repeat(8)}`;
}

function randomPrefix(): string {
  // rejection-free: 36 divides evenly into the 252 values we keep, so every
  // character is equally likely.
  const bytes = randomBytes(TOKEN_PREFIX_LENGTH * 2);
  let prefix = '';

  for (const byte of bytes) {
    if (byte >= 252) continue;
    prefix += PREFIX_ALPHABET[byte % PREFIX_ALPHABET.length];
    if (prefix.length === TOKEN_PREFIX_LENGTH) break;
  }

  return prefix.length === TOKEN_PREFIX_LENGTH ? prefix : randomPrefix();
}
