'use client';

import { Download, FileText, Loader2, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { StatusBadge } from '@/components/documents/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  ApiError,
  deleteDocument,
  documentDownload,
  listDocuments,
  type DocumentSource,
  type DocumentStatus,
  type DocumentSummary,
} from '@/lib/api';
import { formatBytes, formatDuration, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 25;

export default function DocumentsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<DocumentStatus | ''>('');
  const [source, setSource] = useState<DocumentSource | ''>('');

  // The list lags the keystroke rather than the input doing so: typing stays
  // responsive while the results catch up.
  const deferredSearch = useDeferredValue(search);

  const [rows, setRows] = useState<DocumentSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Only the newest query may write to state: a slow early request must not
  // overwrite the results of a later, narrower one.
  const requestId = useRef(0);

  const filters = useMemo(
    () => ({
      ...(deferredSearch ? { search: deferredSearch } : {}),
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
    }),
    [deferredSearch, status, source],
  );

  useEffect(() => {
    const id = ++requestId.current;

    // Results are swapped in when they arrive rather than clearing the table
    // first: refiltering an already-loaded list should not flash empty.
    listDocuments({ limit: PAGE_SIZE, ...filters })
      .then((page) => {
        if (id !== requestId.current) return;
        setRows(page.data);
        setNextCursor(page.nextCursor);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (id !== requestId.current) return;
        setError(caught instanceof ApiError ? caught.message : 'Could not load documents.');
      })
      .finally(() => {
        if (id === requestId.current) setLoaded(true);
      });
  }, [filters]);

  // The list is a keystroke or so behind the box while a search settles.
  const stale = search !== deferredSearch;

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    setLoadingMore(true);

    try {
      const page = await listDocuments({ limit: PAGE_SIZE, cursor: nextCursor, ...filters });

      setRows((current) => [...current, ...page.data]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load more documents.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function download(id: string): Promise<void> {
    setBusyId(id);

    try {
      const { url } = await documentDownload(id);
      window.location.assign(url);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not prepare that download.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(document: DocumentSummary): Promise<void> {
    const label = document.title ?? document.id;
    if (!window.confirm(`Delete “${label}”? The PDF is removed from storage too.`)) return;

    setBusyId(document.id);

    try {
      await deleteDocument(document.id);
      setRows((current) => current.filter((row) => row.id !== document.id));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete that document.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-muted-foreground text-sm">Every render that was saved.</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event: FormEvent) => event.preventDefault()}
        role="search"
      >
        <div className="grid min-w-56 flex-1 gap-1.5">
          <Label htmlFor="search">Search titles</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              id="search"
              value={search}
              placeholder="invoice"
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="status">Status</Label>
          <Select
            id="status"
            value={status}
            className="w-40"
            onChange={(event) => setStatus(event.target.value as DocumentStatus | '')}
          >
            <option value="">Any status</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="rendering">Rendering</option>
            <option value="queued">Queued</option>
            <option value="expired">Expired</option>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="source">Source</Label>
          <Select
            id="source"
            value={source}
            className="w-40"
            onChange={(event) => setSource(event.target.value as DocumentSource | '')}
          >
            <option value="">Any source</option>
            <option value="ui">Dashboard</option>
            <option value="api">API</option>
          </Select>
        </div>
      </form>

      <p aria-live="polite" className="text-destructive min-h-5 text-sm">
        {error}
      </p>

      <div
        className={cn(
          'overflow-x-auto rounded-lg border transition-opacity',
          stale && 'opacity-60',
        )}
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Saved renders, newest first</caption>
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Title
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Source
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Pages
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Size
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Took
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Created
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {!loaded ? (
              <tr>
                <td colSpan={8} className="text-muted-foreground px-4 py-10 text-center">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <FileText
                    className="text-muted-foreground mx-auto mb-2 size-6"
                    aria-hidden="true"
                  />
                  <p className="text-muted-foreground">
                    {search || status || source
                      ? 'Nothing matches those filters.'
                      : 'No documents yet.'}
                  </p>
                  {!search && !status && !source ? (
                    <Link
                      href="/playground"
                      className="text-foreground mt-1 inline-block text-sm underline underline-offset-4"
                    >
                      Render one in the playground
                    </Link>
                  ) : null}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30 border-t">
                  <td className="max-w-64 truncate px-4 py-2.5">
                    <Link
                      href={`/documents/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.title ?? <span className="text-muted-foreground">Untitled</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5">
                    {row.source === 'ui' ? 'Dashboard' : 'API'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.pageCount ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatBytes(row.byteSize)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatDuration(row.durationMs)}
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5">
                    <time dateTime={row.createdAt}>{formatRelative(row.createdAt)}</time>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Download ${row.title ?? row.id}`}
                        disabled={row.status !== 'completed' || busyId === row.id}
                        onClick={() => void download(row.id)}
                      >
                        <Download className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${row.title ?? row.id}`}
                        disabled={busyId === row.id}
                        onClick={() => void remove(row)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
