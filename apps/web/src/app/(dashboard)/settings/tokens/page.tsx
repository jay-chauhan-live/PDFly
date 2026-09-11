'use client';

import { AlertTriangle, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  ApiError,
  createToken,
  listTokens,
  revokeToken,
  TOKEN_SCOPES,
  type ApiTokenSummary,
  type MintedApiToken,
  type TokenScope,
} from '@/lib/api';
import { useNow } from '@/hooks/use-now';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const SCOPE_HELP: Record<TokenScope, string> = {
  'pdf:render': 'Create PDFs',
  'documents:read': 'List and download documents',
  'documents:delete': 'Delete documents',
};

const EXPIRY_CHOICES = [
  { label: 'No expiry', days: null },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
] as const;

export default function TokensPage() {
  const now = useNow();
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [scopes, setScopes] = useState<TokenScope[]>(['pdf:render']);
  const [minted, setMinted] = useState<MintedApiToken | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    listTokens()
      .then(setTokens)
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : 'Could not load tokens.');
      })
      .finally(() => setLoaded(true));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const days = Number(data.get('expiry') ?? 0);

    try {
      const created = await createToken({
        name: String(data.get('name') ?? '').trim(),
        scopes,
        ...(days > 0 ? { expiresAt: new Date(Date.now() + days * 86_400_000).toISOString() } : {}),
      });

      setMinted(created);
      setTokens((current) => [created, ...current]);
      setShowForm(false);
      setScopes(['pdf:render']);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create that token.');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(token: ApiTokenSummary): Promise<void> {
    if (!window.confirm(`Revoke “${token.name}”? Anything using it stops working immediately.`)) {
      return;
    }

    setBusyId(token.id);

    try {
      const revoked = await revokeToken(token.id);
      setTokens((current) => current.map((t) => (t.id === revoked.id ? revoked : t)));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not revoke that token.');
    } finally {
      setBusyId(null);
    }
  }

  function toggleScope(scope: TokenScope, checked: boolean): void {
    setScopes((current) =>
      checked ? [...current, scope] : current.filter((value) => value !== scope),
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API tokens</h1>
          <p className="text-muted-foreground text-sm">
            For calling the API from your own code. Each one is shown once.
          </p>
        </div>

        <Button onClick={() => setShowForm((open) => !open)} disabled={showForm}>
          <Plus className="size-4" />
          New token
        </Button>
      </div>

      <p aria-live="polite" className="text-destructive min-h-5 text-sm">
        {error}
      </p>

      {minted ? <MintedTokenCard token={minted} onDismiss={() => setMinted(null)} /> : null}

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>New token</CardTitle>
            <CardDescription>
              Give it only the scopes it needs — a token that can only render cannot delete your
              history if it leaks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={80}
                  placeholder="Billing service"
                />
              </div>

              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm leading-none font-medium">Scopes</legend>
                {TOKEN_SCOPES.map((scope) => (
                  <label key={scope} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={scopes.includes(scope)}
                      onChange={(event) => toggleScope(scope, event.target.checked)}
                    />
                    <code className="text-xs">{scope}</code>
                    <span className="text-muted-foreground">— {SCOPE_HELP[scope]}</span>
                  </label>
                ))}
              </fieldset>

              <div className="grid gap-1.5">
                <Label htmlFor="expiry">Expires</Label>
                <Select id="expiry" name="expiry" defaultValue="0" className="w-48">
                  {EXPIRY_CHOICES.map((choice) => (
                    <option key={choice.label} value={choice.days ?? 0}>
                      {choice.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={creating || scopes.length === 0}>
                  {creating ? <Loader2 className="size-4 animate-spin" /> : null}
                  Create token
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>

              {scopes.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  A token with no scopes could not do anything.
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">API tokens for this organization</caption>
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Name
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Token
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Scopes
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Last used
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {!loaded ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-4 py-10 text-center">
                  Loading…
                </td>
              </tr>
            ) : tokens.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <KeyRound
                    className="text-muted-foreground mx-auto mb-2 size-6"
                    aria-hidden="true"
                  />
                  <p className="text-muted-foreground">No API tokens yet.</p>
                </td>
              </tr>
            ) : (
              tokens.map((token) => {
                const expired =
                  token.expiresAt !== null && new Date(token.expiresAt).getTime() <= now;
                const dead = token.revokedAt !== null || expired;

                return (
                  <tr key={token.id} className={cn('border-t', dead && 'opacity-55')}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{token.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {token.revokedAt
                          ? `Revoked ${formatRelative(token.revokedAt)}`
                          : expired
                            ? `Expired ${formatRelative(token.expiresAt ?? '')}`
                            : token.expiresAt
                              ? `Expires ${formatDateTime(token.expiresAt)}`
                              : `Created ${formatRelative(token.createdAt)}`}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <code className="text-xs">{token.masked}</code>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {token.scopes.map((scope) => (
                          <span key={scope} className="bg-muted rounded px-1.5 py-0.5 text-xs">
                            {scope}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5">
                      {token.lastUsedAt ? formatRelative(token.lastUsedAt) : 'Never'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Revoke ${token.name}`}
                        disabled={dead || busyId === token.id}
                        onClick={() => void revoke(token)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The one moment the secret exists outside the database. There is no recovery
 * path by design, so the card says so plainly rather than letting someone
 * navigate away assuming they can come back for it.
 */
function MintedTokenCard({ token, onDismiss }: { token: MintedApiToken; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(token.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="border-amber-600/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
          Copy “{token.name}” now
        </CardTitle>
        <CardDescription>
          This is the only time it is shown. It is stored as a hash, so nobody — including us — can
          show it to you again. Lost one? Revoke it and create another.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <code className="bg-muted/50 min-w-0 flex-1 overflow-x-auto rounded-md border px-3 py-2 text-xs whitespace-nowrap">
            {token.token}
          </code>
          <Button variant="outline" onClick={() => void copy()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <p aria-live="polite" className="sr-only">
          {copied ? 'Token copied to clipboard' : ''}
        </p>

        <Button variant="ghost" className="self-start" onClick={onDismiss}>
          I have saved it
        </Button>
      </CardContent>
    </Card>
  );
}
