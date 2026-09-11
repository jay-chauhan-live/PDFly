import { render, screen } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { describe, expect, it } from 'vitest';
import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  it('exposes an accessible name despite being icon-only (PLAN §9)', () => {
    render(
      <ThemeProvider attribute="class">
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', { name: 'Change colour theme' })).toBeDefined();
  });
});
