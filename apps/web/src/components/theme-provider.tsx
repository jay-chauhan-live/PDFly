'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * `class` strategy so shadcn's `.dark` token block applies (PLAN §9).
 * For a signed-in user the choice is mirrored to `users.theme_pref` and
 * re-applied when the session resolves, so it follows them across devices —
 * see AuthProvider, which this must therefore wrap.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
