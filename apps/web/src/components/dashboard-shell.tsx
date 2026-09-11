'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import {
  CircleHelp,
  FileText,
  LayoutDashboard,
  LogOut,
  PlayCircle,
  Settings,
  User,
} from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** PLAN §9. Routes not yet built are marked and rendered as disabled. */
const NAV = [
  { href: '/', label: 'Overview', Icon: LayoutDashboard, ready: true },
  { href: '/playground', label: 'Playground', Icon: PlayCircle, ready: true },
  { href: '/documents', label: 'Documents', Icon: FileText, ready: true },
  { href: '/settings/tokens', label: 'Settings', Icon: Settings, ready: true },
  { href: '/profile', label: 'Profile', Icon: User, ready: true },
  { href: '/help', label: 'Help', Icon: CircleHelp, ready: true },
] as const;

/**
 * Client-side route protection.
 *
 * This is a UX gate, not a security boundary — the refresh cookie is scoped to
 * the api's /v1/auth path, so the Next server never receives it and middleware
 * could not read it anyway. Every endpoint enforces authentication itself.
 */
export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-muted-foreground text-sm" role="status">
          Loading…
        </p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" aria-label="PDFly home">
            <Logo />
          </Link>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground hidden text-sm sm:inline">{user.email}</span>
            <ThemeToggle />
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => void logout()}>
              <LogOut />
            </Button>
          </div>
        </div>

        <nav aria-label="Main" className="mx-auto w-full max-w-6xl px-6">
          <ul className="flex gap-1 overflow-x-auto">
            {NAV.map(({ href, label, Icon, ready }) => {
              const active =
                href === '/'
                  ? pathname === '/'
                  : pathname === href || pathname.startsWith(`${href}/`);

              return (
                <li key={href}>
                  {ready ? (
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'focus-visible:ring-ring/50 inline-flex items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:outline-none',
                        active
                          ? 'border-foreground font-medium'
                          : 'text-muted-foreground hover:text-foreground border-transparent',
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {label}
                    </Link>
                  ) : (
                    <span
                      aria-disabled="true"
                      title="Not built yet"
                      className="text-muted-foreground/50 inline-flex cursor-not-allowed items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap"
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
