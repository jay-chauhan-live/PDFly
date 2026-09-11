'use client';

import { AlertCircle, FileDown, Loader2, Save, SlidersHorizontal } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CurlSnippet } from '@/components/playground/curl-snippet';
import { OptionsPanel } from '@/components/playground/options-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ApiError,
  getDocument,
  previewPdf,
  renderDocument,
  type RenderOptions,
  type RenderRequest,
} from '@/lib/api';

// Monaco touches `window` at module scope and is large; it has no business in
// the server bundle or the first paint.
const HtmlEditor = dynamic(
  () => import('@/components/playground/html-editor').then((m) => m.HtmlEditor),
  {
    ssr: false,
    loading: () => (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Loading editor…
      </div>
    ),
  },
);

const STARTER_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; color: #0f172a; }
      h1 { font-size: 28px; margin: 0 0 4px; }
      .muted { color: #64748b; }
      table { width: 100%; border-collapse: collapse; margin-top: 24px; }
      th, td { text-align: left; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
      td.amount, th.amount { text-align: right; }
    </style>
  </head>
  <body>
    <h1>Invoice 001</h1>
    <p class="muted">Issued 1 January 2026</p>

    <table>
      <thead>
        <tr><th>Description</th><th class="amount">Amount</th></tr>
      </thead>
      <tbody>
        <tr><td>Rendering, 10,000 documents</td><td class="amount">£40.00</td></tr>
        <tr><td>Storage, 5 GB</td><td class="amount">£2.50</td></tr>
      </tbody>
    </table>
  </body>
</html>
`;

/** Long enough that a burst of typing is one render, short enough to feel live. */
const DEBOUNCE_MS = 700;

/**
 * Read at the point of use rather than into state: on the server there is no
 * navigator, and by the time a preview exists to show, this only ever runs in
 * the browser — so there is no render to mismatch.
 */
function hasPdfViewer(): boolean {
  return typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false;
}

export default function PlaygroundPage() {
  const router = useRouter();
  const seedFrom = useSearchParams().get('from');

  const [html, setHtml] = useState(STARTER_HTML);
  const [options, setOptions] = useState<RenderOptions>({ format: 'A4', printBackground: true });
  const [title, setTitle] = useState('Invoice 001');
  const [showOptions, setShowOptions] = useState(true);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ pageCount: number; durationMs: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  // Arriving from a document carries its settings across, but not its markup:
  // the HTML was rendered and discarded, never stored.
  useEffect(() => {
    if (!seedFrom) return;
    let cancelled = false;

    void getDocument(seedFrom)
      .then((document) => {
        if (cancelled) return;
        if (document.optionsJson) setOptions(document.optionsJson);
        if (document.title) setTitle(document.title);
        setSeeded(document.title ?? document.id);
      })
      .catch(() => {
        if (!cancelled) setSeeded(null);
      });

    return () => {
      cancelled = true;
    };
  }, [seedFrom]);

  const request: RenderRequest = {
    html,
    options,
    ...(title.trim() ? { title: title.trim() } : {}),
  };

  // Object URLs are revoked as they are replaced; the browser would otherwise
  // hold every preview PDF of the session in memory.
  const previewUrlRef = useRef<string | null>(null);
  const replacePreview = useCallback((next: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = next;
    setPreviewUrl(next);
  }, []);

  useEffect(() => () => replacePreview(null), [replacePreview]);

  useEffect(() => {
    if (!html.trim()) return;

    // A render in flight is abandoned the moment its input is stale, so a fast
    // typist does not queue up a backlog of obsolete PDFs.
    const controller = new AbortController();

    const timer = setTimeout(() => {
      setRendering(true);
      setError(null);

      previewPdf({ html, options }, controller.signal)
        .then((result) => {
          replacePreview(URL.createObjectURL(result.blob));
          setStats({ pageCount: result.pageCount, durationMs: result.durationMs });
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setError(caught instanceof ApiError ? caught.message : 'Could not render this document.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setRendering(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [html, options, replacePreview]);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      const result = await renderDocument(request);
      router.push(`/documents/${result.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save this render.');
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Playground</h1>
          <p className="text-muted-foreground text-sm">
            {seeded
              ? `Settings from “${seeded}”. Its HTML was not stored, so start from yours.`
              : 'Previews are drafts — nothing is stored until you save one.'}
          </p>
        </div>

        <div className="flex items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              maxLength={255}
              className="w-56"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <Button variant="outline" onClick={() => setShowOptions((open) => !open)}>
            <SlidersHorizontal className="size-4" />
            {showOptions ? 'Hide options' : 'Options'}
          </Button>

          <Button onClick={() => void save()} disabled={saving || !html.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? 'Saving…' : 'Save render'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-sm font-medium">HTML</h2>
            <span className="text-muted-foreground text-xs">
              {html.length.toLocaleString()} chars
            </span>
          </div>

          <div className="h-[60vh] min-h-80">
            <HtmlEditor value={html} onChange={setHtml} />
          </div>

          <CurlSnippet request={request} />
        </div>

        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-sm font-medium">Preview</h2>

            {/* aria-live so render status is announced, not only animated. */}
            <span aria-live="polite" className="text-muted-foreground text-xs">
              {rendering
                ? 'Rendering…'
                : stats
                  ? `${stats.pageCount} page${stats.pageCount === 1 ? '' : 's'} · ${stats.durationMs}ms`
                  : ''}
            </span>
          </div>

          <div className="bg-muted/30 relative h-[60vh] min-h-80">
            {error ? (
              <div className="text-destructive absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm">
                <AlertCircle className="size-5" aria-hidden="true" />
                {error}
              </div>
            ) : previewUrl && !hasPdfViewer() ? (
              // Some browsers, and some managed installs, have the built-in PDF
              // viewer turned off. An <iframe> there renders nothing at all, so
              // say what happened rather than showing an empty rectangle.
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm">
                <FileDown className="text-muted-foreground size-5" aria-hidden="true" />
                <p className="text-muted-foreground">This browser will not display PDFs inline.</p>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-4"
                >
                  Open the preview in a new tab
                </a>
              </div>
            ) : previewUrl ? (
              <iframe
                key={previewUrl}
                src={previewUrl}
                title="Rendered PDF preview"
                className="size-full"
              />
            ) : (
              <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
                {rendering ? 'Rendering…' : 'Start typing to see a preview.'}
              </div>
            )}

            {rendering && previewUrl ? (
              <div className="bg-background/80 absolute top-2 right-2 rounded-md border px-2 py-1">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {showOptions ? (
        <div className="rounded-lg border p-4">
          <OptionsPanel options={options} onChange={setOptions} />
        </div>
      ) : null}
    </div>
  );
}
