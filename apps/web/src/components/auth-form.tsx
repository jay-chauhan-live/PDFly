'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';

const PASSWORD_MIN = 12;

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register';
  const { login, register } = useAuth();
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');

    try {
      if (isRegister) {
        await register({
          email,
          password,
          name: String(data.get('name') ?? ''),
          organizationName: String(data.get('organizationName') ?? '') || undefined,
        });
      } else {
        await login(email, password);
      }

      router.push('/');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.errors?.[0] ?? caught.message)
          : 'Something went wrong. Please try again.',
      );
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div className="flex justify-center">
        <Logo />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isRegister ? 'Create an account' : 'Sign in'}</CardTitle>
          <CardDescription>
            {isRegister
              ? 'Your account comes with a new organization that you own.'
              : 'Welcome back.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {isRegister && (
              <div className="grid gap-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" name="name" autoComplete="name" required maxLength={120} />
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                required
                minLength={isRegister ? PASSWORD_MIN : undefined}
                aria-describedby={isRegister ? 'password-hint' : undefined}
              />
              {isRegister && (
                <p id="password-hint" className="text-muted-foreground text-xs">
                  At least {PASSWORD_MIN} characters. Length matters more than symbols.
                </p>
              )}
            </div>

            {isRegister && (
              <div className="grid gap-2">
                <Label htmlFor="organizationName">Organization (optional)</Label>
                <Input id="organizationName" name="organizationName" maxLength={120} />
              </div>
            )}

            {/* aria-live so a screen reader announces the failure (PLAN §9). */}
            <p aria-live="polite" className="text-destructive min-h-5 text-sm">
              {error}
            </p>

            <Button type="submit" disabled={pending}>
              {pending ? 'Working…' : isRegister ? 'Create account' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-center text-sm">
        {isRegister ? 'Already have an account? ' : 'No account yet? '}
        <Link
          href={isRegister ? '/login' : '/register'}
          className="text-foreground underline underline-offset-4"
        >
          {isRegister ? 'Sign in' : 'Create one'}
        </Link>
      </p>
    </div>
  );
}
