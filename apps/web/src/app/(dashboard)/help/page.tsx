'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { API_BASE } from '@/lib/api';

const SECTIONS = [
  { id: 'quickstart', label: 'Quickstart' },
  { id: 'rendering', label: 'Rendering' },
  { id: 'protection', label: 'Protection and watermarks' },
  { id: 'async', label: 'Async and webhooks' },
  { id: 'limits', label: 'Limits and errors' },
  { id: 'html-tips', label: 'HTML and CSS tips' },
] as const;

export default function HelpPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      {/* A real <nav> so a screen reader can jump straight to the section list. */}
      <nav aria-label="Help sections" className="lg:sticky lg:top-8 lg:w-56 lg:shrink-0">
        <h2 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          On this page
        </h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 lg:flex-col lg:gap-1">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded text-sm underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:outline-none"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
          <p className="text-muted-foreground text-sm">
            Everything the API does, and the things that surprise people.
          </p>
        </header>

        <Section id="quickstart" title="Quickstart">
          <p>
            Mint a token under{' '}
            <Link href="/settings/tokens" className="underline underline-offset-4">
              Settings
            </Link>
            , then send HTML and get a PDF back. The token is shown once and stored as a hash, so it
            cannot be recovered — revoke and create another if you lose it.
          </p>

          <Snippet
            label="Your first render"
            code={`curl ${API_BASE}/v1/pdf \\
  -H "Authorization: Bearer $PDFLY_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"html":"<h1>Hello</h1>","title":"Hello"}'`}
          />

          <p>
            The response is JSON with a short-lived signed <code>url</code>. Pass{' '}
            <code>&quot;output&quot;: &quot;binary&quot;</code> to get the PDF bytes directly, or{' '}
            <code>&quot;base64&quot;</code> to embed it.
          </p>
        </Section>

        <Section id="rendering" title="Rendering">
          <p>
            Every option from the{' '}
            <Link href="/playground" className="underline underline-offset-4">
              playground
            </Link>{' '}
            maps to a field in <code>options</code>. The playground&apos;s &ldquo;Equivalent API
            call&rdquo; panel writes the exact request for whatever is on screen, which is the
            quickest way to learn the shape.
          </p>

          <Snippet
            label="Page setup"
            code={`{
  "html": "<h1>Invoice</h1>",
  "options": {
    "format": "A4",
    "landscape": false,
    "margin": { "top": "15mm", "right": "15mm", "bottom": "15mm", "left": "15mm" },
    "printBackground": true,
    "scale": 1,
    "footerTemplate": "<div style='font-size:9px'>Page <span class='pageNumber'></span></div>",
    "waitUntil": "load"
  }
}`}
          />

          <Detail summary="Why is my image missing?">
            <p>
              External assets are refused by default — the safer and faster posture, and the one
              that stops a document reaching addresses it should not. Inline images as{' '}
              <code>data:</code> URIs, or set <code>&quot;allowExternalAssets&quot;: true</code> and
              optionally <code>assetHostAllowlist</code> to name the hosts you trust.
            </p>
            <p>
              Even with external assets enabled, private and loopback addresses are always refused.
              A host that resolves to <code>169.254.169.254</code> or <code>10.0.0.0/8</code> will
              not be fetched.
            </p>
          </Detail>

          <Detail summary="Why is my JavaScript not running?">
            <p>
              JavaScript is off unless you ask for it, because every script that runs is code from
              the document being rendered. Set <code>&quot;javascript&quot;: true</code> in{' '}
              <code>options</code>, and pair it with{' '}
              <code>&quot;waitUntil&quot;: &quot;networkidle&quot;</code> if the script fetches
              anything.
            </p>
          </Detail>
        </Section>

        <Section id="protection" title="Protection and watermarks">
          <p>
            Watermarks are stamped onto the finished PDF rather than injected as CSS, so they appear
            on every page including ones your HTML never anticipated, and your own styles cannot
            override them.
          </p>

          <Snippet
            label="Watermark and password"
            code={`{
  "html": "<h1>Confidential</h1>",
  "watermark": {
    "type": "text",
    "text": "CONFIDENTIAL",
    "opacity": 0.12,
    "rotation": -45,
    "position": "center",
    "pages": "all"
  },
  "protection": {
    "userPassword": "opens-the-document",
    "permissions": { "print": true, "copy": false, "modify": false }
  }
}`}
          />

          <Detail summary="What happens to my passwords?">
            <p>
              They are used for the one render and never stored — not in your history, not in our
              logs. <code>options</code> on a document records <code>hasUserPassword: true</code>{' '}
              and the permission flags, never the values.
            </p>
            <p>
              Lose the password and the document is unrecoverable. That is the point: if we could
              open it for you, so could anyone who reached our database.
            </p>
          </Detail>

          <Detail summary="Omitting the owner password">
            <p>
              If you set permissions but no <code>ownerPassword</code>, one is generated and thrown
              away. Leaving it unset entirely would make the restrictions trivially removable — this
              way nobody, including us, can lift them.
            </p>
          </Detail>
        </Section>

        <Section id="async" title="Async and webhooks">
          <p>
            For large documents, or when you would rather not hold a connection open, enqueue
            instead. You get the document id immediately and can poll or wait to be told.
          </p>

          <Snippet
            label="Enqueue"
            code={`curl ${API_BASE}/v1/pdf/async \\
  -H "Authorization: Bearer $PDFLY_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"html":"<h1>Big</h1>","webhookUrl":"https://example.com/hooks/pdfly"}'

# => 202 {"id":"...","status":"queued","statusUrl":"/v1/jobs/..."}`}
          />

          <p>
            Webhook deliveries are signed. Verify them before trusting the body — the signature
            covers a timestamp as well, so a captured request cannot be replayed later.
          </p>

          <Snippet
            label="Verifying a webhook (Node)"
            code={`import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(req, rawBody) {
  const timestamp = req.headers['x-pdfly-timestamp'];
  const presented = req.headers['x-pdfly-signature'];

  // Reject anything older than five minutes.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = 'v1=' + createHmac('sha256', process.env.PDFLY_WEBHOOK_SECRET)
    .update(timestamp + '.' + rawBody)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(presented));
  return a.length === b.length && timingSafeEqual(a, b);
}`}
          />

          <p className="text-muted-foreground text-sm">
            Four attempts, backing off 1s, 4s then 9s. A 4xx other than 429 is taken as &ldquo;never
            send this again&rdquo; and is not retried. Your endpoint must be https and must not
            resolve to a private address.
          </p>
        </Section>

        <Section id="limits" title="Limits and errors">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
            <Limit term="HTML size" detail="5 MB of markup" />
            <Limit term="Pages" detail="500 per document" />
            <Limit term="Render timeout" detail="20s by default, 60s maximum" />
            <Limit term="Rate limit" detail="120 requests a minute per credential" />
            <Limit term="Retention" detail="PDFs are deleted after their expiry" />
          </dl>

          <p>
            Errors are{' '}
            <a
              href="https://www.rfc-editor.org/rfc/rfc7807"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              problem+json
            </a>{' '}
            with a stable <code>code</code>. Switch on the code, not the message — the message is
            for people.
          </p>

          <Snippet
            label="An error"
            code={`{
  "type": "https://docs.pdfly.dev/errors/render_timeout",
  "title": "render timeout",
  "status": 504,
  "code": "render_timeout",
  "detail": "Rendering exceeded 20000ms",
  "instance": "/v1/pdf"
}`}
          />

          <p className="text-muted-foreground text-sm">
            Every response carries <code>X-RateLimit-Limit</code>, <code>-Remaining</code> and{' '}
            <code>-Reset</code>. Send an <code>Idempotency-Key</code> on renders so a retry after a
            timeout returns the original document rather than billing you twice.
          </p>
        </Section>

        <Section id="html-tips" title="HTML and CSS tips">
          <Detail summary="Controlling page breaks">
            <p>
              <code>break-inside: avoid</code> keeps a block together;{' '}
              <code>break-before: page</code> forces a new page. Table headers repeat automatically
              if you use a real <code>&lt;thead&gt;</code>.
            </p>
          </Detail>

          <Detail summary="Fonts">
            <p>
              Inline fonts as <code>data:</code> URIs, or allowlist the host they come from. A
              webfont that fails to load falls back silently and the layout shifts, so prefer a
              stack with a system fallback you are happy with.
            </p>
          </Detail>

          <Detail summary="Headers and footers">
            <p>
              They are separate documents from the page, with their own (very small) default font
              size and no access to your stylesheet. Set sizes inline. Chromium substitutes{' '}
              <code>pageNumber</code>, <code>totalPages</code>, <code>title</code>,{' '}
              <code>date</code> and <code>url</code> into elements carrying those class names.
            </p>
          </Detail>

          <Detail summary="Print styles apply">
            <p>
              Rendering uses print media, so <code>@media print</code> rules take effect and{' '}
              <code>@media screen</code> ones do not. Set{' '}
              <code>&quot;printBackground&quot;: true</code> if your design relies on background
              colours — browsers strip them when printing by default.
            </p>
          </Detail>
        </Section>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    // scroll-mt so the heading is not hidden under the sticky header when a
    // section link jumps to it.
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-8">
      <h2 id={`${id}-heading`} className="mb-3 text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Limit({ term, detail }: { term: string; detail: string }) {
  return (
    <>
      <dt className="font-medium">{term}</dt>
      <dd className="text-muted-foreground">{detail}</dd>
    </>
  );
}

function Detail({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border">
      <summary className="focus-visible:ring-ring/50 hover:bg-muted/40 cursor-pointer rounded-lg px-4 py-2.5 font-medium select-none focus-visible:ring-[3px] focus-visible:outline-none">
        {summary}
      </summary>
      <div className="flex flex-col gap-2 px-4 pt-1 pb-3">{children}</div>
    </details>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex-row items-center justify-between gap-2 border-b px-4 py-2">
        <CardTitle className="text-xs font-medium">{label}</CardTitle>
        <CardDescription className="sr-only">A code example you can copy</CardDescription>
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <pre className="bg-muted/40 overflow-x-auto px-4 py-3 text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
      </CardContent>
      <p aria-live="polite" className="sr-only">
        {copied ? `${label} copied to clipboard` : ''}
      </p>
    </Card>
  );
}
