import { ProblemError } from '../common/errors/problem.js';

export type PageSelection = string;

/**
 * Resolves `all`, `first`, `last` or a range list like `1-3,7` into zero-based
 * page indices (PLAN §6).
 *
 * Out-of-range pages are dropped rather than rejected: a caller stamping
 * `1-10` on a document that turned out to be three pages long meant "the
 * first ten if they exist", and failing the whole render over it would be
 * unkind. Nonsense — letters, reversed ranges — is still an error, because
 * that is a typo the caller wants to hear about.
 */
export function resolvePages(selection: PageSelection | undefined, pageCount: number): number[] {
  const all = Array.from({ length: pageCount }, (_, index) => index);

  if (!selection || selection === 'all') return all;
  if (selection === 'first') return pageCount > 0 ? [0] : [];
  if (selection === 'last') return pageCount > 0 ? [pageCount - 1] : [];

  const chosen = new Set<number>();

  for (const part of selection.split(',')) {
    const token = part.trim();
    if (!token) continue;

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);

    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);

      if (from < 1 || to < from) {
        throw new ProblemError('invalid_request', 400, `Invalid page range "${token}"`);
      }

      for (let page = from; page <= Math.min(to, pageCount); page += 1) {
        chosen.add(page - 1);
      }

      continue;
    }

    if (!/^\d+$/.test(token) || Number(token) < 1) {
      throw new ProblemError('invalid_request', 400, `Invalid page selection "${token}"`);
    }

    const page = Number(token);
    if (page <= pageCount) chosen.add(page - 1);
  }

  return [...chosen].sort((a, b) => a - b);
}
