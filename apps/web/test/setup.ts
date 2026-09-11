import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom implements no media queries, and next-themes calls matchMedia during
// its first render to resolve the "system" theme.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

afterEach(() => {
  cleanup();
});
