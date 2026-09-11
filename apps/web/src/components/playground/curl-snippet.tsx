'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { API_BASE, type RenderRequest } from '@/lib/api';

/**
 * Shell-quotes a string for single-quoted context: end the quote, emit an
 * escaped quote, reopen. Without this a title containing an apostrophe would
 * produce a command that does not run.
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildCurl(request: RenderRequest): string {
  const body = JSON.stringify(request, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n');

  return [
    `curl ${API_BASE}/v1/pdf \\`,
    `  -H 'Authorization: Bearer $PDFLY_TOKEN' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d ${shellQuote(body)}`,
  ].join('\n');
}

/**
 * The exact equivalent API call for what is on screen (PLAN §9). Showing it
 * rather than only copying it is the point: it is the shortest path from
 * "I clicked some options" to "I can automate this".
 */
export function CurlSnippet({ request }: { request: RenderRequest }) {
  const [copied, setCopied] = useState(false);
  const command = buildCurl(request);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the snippet below is still selectable.
      setCopied(false);
    }
  }

  return (
    <details className="group border-t">
      <summary className="hover:bg-muted/50 flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm font-medium select-none">
        Equivalent API call
        <span className="text-muted-foreground text-xs group-open:hidden">show</span>
        <span className="text-muted-foreground hidden text-xs group-open:inline">hide</span>
      </summary>

      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          className="absolute top-2 right-2 z-10"
          onClick={() => void copy()}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>

        <pre className="bg-muted/40 max-h-64 overflow-auto px-4 py-3 text-xs leading-relaxed">
          <code>{command}</code>
        </pre>

        {/* aria-live so the copy result is announced, not just shown. */}
        <p aria-live="polite" className="sr-only">
          {copied ? 'Command copied to clipboard' : ''}
        </p>
      </div>
    </details>
  );
}
