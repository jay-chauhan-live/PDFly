'use client';

import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, refreshSession, setAccessToken, type ApiUser } from '@/lib/api';

interface AuthState {
  user: ApiUser | null;
  /** True until the initial refresh attempt settles. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    name: string;
    organizationName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: ApiUser) => void;
  /** Applies a theme locally and records it on the account (PLAN §9). */
  saveThemePref: (pref: ApiUser['themePref']) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { setTheme } = useTheme();

  /**
   * The one place a session becomes current. Every entry point goes through
   * it, so the account's theme is applied however the user arrived — a fresh
   * sign-in, a registration, or a reload that recovered the cookie. The
   * account's preference wins over whatever this browser last stored, which
   * is what makes the theme follow someone across devices (PLAN §9).
   */
  const adopt = useCallback(
    (session: ApiUser | null) => {
      setUser(session);
      if (session) setTheme(session.themePref);
    },
    [setTheme],
  );

  // On load there is no access token in memory, but the httpOnly refresh
  // cookie may still be valid — so try once before deciding the user is out.
  useEffect(() => {
    let cancelled = false;

    void refreshSession()
      .then((session) => {
        if (!cancelled) adopt(session?.user ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [adopt]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api<{ accessToken: string; user: ApiUser }>('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      setAccessToken(result.accessToken);
      adopt(result.user);
    },
    [adopt],
  );

  const register = useCallback(
    async (input: { email: string; password: string; name: string; organizationName?: string }) => {
      const result = await api<{ accessToken: string; user: ApiUser }>('/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      });

      setAccessToken(result.accessToken);
      adopt(result.user);
    },
    [adopt],
  );

  const logout = useCallback(async () => {
    await api<void>('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    router.push('/login');
  }, [router]);

  const saveThemePref = useCallback(
    (pref: ApiUser['themePref']) => {
      // Applied immediately; the write is a background detail the user should
      // never wait on, and next-themes has already stored it locally.
      setTheme(pref);
      setUser((current) => (current ? { ...current, themePref: pref } : current));

      void api<ApiUser>('/v1/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ themePref: pref }),
      }).catch(() => undefined);
      // setTheme is stable in next-themes, but listed for the exhaustive-deps rule.
    },
    [setTheme],
  );

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, setUser, saveThemePref }),
    [user, loading, login, register, logout, saveThemePref],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);

  if (!context) throw new Error('useAuth must be used inside AuthProvider');

  return context;
}

/**
 * Null outside an AuthProvider. For chrome that renders on both sides of the
 * sign-in line, where "no session" is an ordinary state rather than a bug.
 */
export function useOptionalAuth(): AuthState | null {
  return useContext(AuthContext);
}
