import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Inkwell',
    template: '%s · Inkwell',
  },
  description: 'HTML to PDF, with password protection and watermarking.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `suppressHydrationWarning` is required by next-themes: the theme class
    // is written to <html> before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
