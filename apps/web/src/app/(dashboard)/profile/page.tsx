'use client';

import { useTheme } from 'next-themes';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api, type ApiUser } from '@/lib/api';

type Status =
  | { kind: 'idle' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? (error.errors?.[0] ?? error.message) : fallback;
}

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const { setTheme } = useTheme();

  const [profileStatus, setProfileStatus] = useState<Status>({ kind: 'idle' });
  const [passwordStatus, setPasswordStatus] = useState<Status>({ kind: 'idle' });

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setProfileStatus({ kind: 'idle' });

    const data = new FormData(event.currentTarget);
    const themePref = String(data.get('themePref') ?? 'system') as ApiUser['themePref'];

    try {
      const updated = await api<ApiUser>('/v1/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: String(data.get('name') ?? ''), themePref }),
      });

      // Persisted server-side so it follows the user across devices (PLAN §9),
      // and applied locally straight away.
      setTheme(themePref);
      setUser(updated);
      setProfileStatus({ kind: 'ok', message: 'Profile saved.' });
    } catch (error) {
      setProfileStatus({ kind: 'error', message: message(error, 'Could not save your profile.') });
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPasswordStatus({ kind: 'idle' });

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      await api<void>('/v1/users/me/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: String(data.get('currentPassword') ?? ''),
          newPassword: String(data.get('newPassword') ?? ''),
        }),
      });

      form.reset();
      setPasswordStatus({
        kind: 'ok',
        message: 'Password changed. Your other sessions have been signed out.',
      });
    } catch (error) {
      setPasswordStatus({
        kind: 'error',
        message: message(error, 'Could not change your password.'),
      });
    }
  }

  if (!user) return null;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            Your email is how you sign in and cannot be changed yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" defaultValue={user.email} disabled />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={user.name} required maxLength={120} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="themePref">Theme</Label>
              <select
                id="themePref"
                name="themePref"
                defaultValue={user.themePref}
                className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:outline-none"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>

            <p
              aria-live="polite"
              className={`min-h-5 text-sm ${
                profileStatus.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {profileStatus.kind === 'idle' ? '' : profileStatus.message}
            </p>

            <Button type="submit" className="self-start">
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Changing your password signs out every other session, including any an attacker may
            hold.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
              />
            </div>

            <p
              aria-live="polite"
              className={`min-h-5 text-sm ${
                passwordStatus.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {passwordStatus.kind === 'idle' ? '' : passwordStatus.message}
            </p>

            <Button type="submit" className="self-start">
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            TOTP is worth having since the dashboard mints API tokens (PLAN §5). Not built yet.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
