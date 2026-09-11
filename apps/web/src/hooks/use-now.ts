'use client';

import { useEffect, useState } from 'react';

/**
 * The current time as render-safe state.
 *
 * Reading `Date.now()` during render makes a component impure: the same props
 * produce different output, which React is free to notice. Ticking it into
 * state keeps render pure and has the side benefit of being live — an expiry
 * passes while someone is looking at the page, and the row updates.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
