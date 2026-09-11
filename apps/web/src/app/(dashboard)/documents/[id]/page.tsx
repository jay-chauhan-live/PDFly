'use client';

import { ArrowLeft, Download, RotateCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@/components/documents/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ApiError,
  deleteDocument,
  documentDownload,
  getDocument,
  type DocumentDetail,
} from '@/lib/api';
import { formatBytes, formatDateTime, formatDuration } from '@/lib/format';

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getDocument(id)
      .then((result) => {
        if (!cancelled) setDocument(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Could not load this document.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function download(): Promise<void> {
    setBusy(true);

    try {
      const { url } = await documentDownload(id);
      window.location.href = url;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not prepare that download.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm('Delete this document? The PDF is removed from storage too.')) return;
    setBusy(true);

    try {
      await deleteDocument(id);
      router.push('/documents');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete this document.');
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Loading…
      </p>
    );
  }

  if (!document) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-destructive text-sm">{error ?? 'No such document.'}</p>
        <Button variant="outline" asChild>
          <Link href="/documents">
            <ArrowLeft className="size-4" />
            Back to documents
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href="/documents"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Documents
        </Link>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {document.title ?? <span className="text-muted-foreground">Untitled</span>}
          </h1>
          <StatusBadge status={document.status} />
        </div>
      </div>

      <p aria-live="polite" className="text-destructive min-h-5 text-sm">
        {error}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void download()} disabled={document.status !== 'completed' || busy}>
          <Download className="size-4" />
          Download
        </Button>

        {/* Carries the settings over, not the markup: the HTML is rendered and
            discarded, never stored (PLAN §4 records options, not source). */}
        <Button variant="outline" asChild>
          <Link href={`/playground?from=${document.id}`}>
            <RotateCw className="size-4" />
            Open settings in playground
          </Link>
        </Button>

        <Button variant="outline" onClick={() => void remove()} disabled={busy}>
          <Trash2 className="size-4" />
          Delete
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Detail label="Pages" value={document.pageCount?.toString() ?? '—'} />
            <Detail label="Size" value={formatBytes(document.byteSize)} />
            <Detail label="Render time" value={formatDuration(document.durationMs)} />
            <Detail label="Source" value={document.source === 'ui' ? 'Dashboard' : 'API'} />
            <Detail label="Created by" value={document.creator?.name ?? 'API token'} />
            <Detail label="Created" value={formatDateTime(document.createdAt)} />
            <Detail
              label="Expires"
              value={document.expiresAt ? formatDateTime(document.expiresAt) : 'Never'}
            />
            <Detail label="Watermarked" value={document.hasWatermark ? 'Yes' : 'No'} />
            <Detail label="Encrypted" value={document.isEncrypted ? 'Yes' : 'No'} />
          </dl>
        </CardContent>
      </Card>

      {document.status === 'failed' ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Render failed</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="font-mono text-xs">{document.errorCode}</p>
            <p className="text-muted-foreground mt-1">{document.errorMessage}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Options used</CardTitle>
        </CardHeader>
        <CardContent>
          {document.optionsJson && Object.keys(document.optionsJson).length > 0 ? (
            <pre className="bg-muted/40 overflow-x-auto rounded-md p-3 text-xs leading-relaxed">
              <code>{JSON.stringify(document.optionsJson, null, 2)}</code>
            </pre>
          ) : (
            <p className="text-muted-foreground text-sm">Rendered with the defaults.</p>
          )}

          <p className="text-muted-foreground mt-3 text-xs">
            The submitted HTML is not kept — only the settings it was rendered with.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
