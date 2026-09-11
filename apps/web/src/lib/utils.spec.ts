import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('drops falsy conditional class names', () => {
    const isHidden = false;
    expect(cn('px-2', isHidden && 'hidden', 'text-sm')).toBe('px-2 text-sm');
  });

  it('lets a later Tailwind utility win over an earlier conflicting one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
