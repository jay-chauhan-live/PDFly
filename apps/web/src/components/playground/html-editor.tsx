'use client';

import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useTheme } from 'next-themes';

/**
 * Monaco, bundled rather than fetched.
 *
 * `@monaco-editor/react` loads the editor from a CDN by default. Pointing it
 * at the npm package instead keeps the dashboard working offline, keeps the
 * editor version pinned with the lockfile, and avoids a third-party script
 * origin that a content security policy would otherwise have to allow.
 *
 * The workers must be wired up by hand for the same reason: without them
 * Monaco falls back to the main thread and HTML validation goes quiet.
 */
if (typeof window !== 'undefined') {
  window.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      return label === 'html'
        ? new Worker(new URL('./html.worker.ts', import.meta.url), { type: 'module' })
        : new Worker(new URL('./editor.worker.ts', import.meta.url), { type: 'module' });
    },
  };

  loader.config({ monaco });
}

export function HtmlEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  // Undefined until next-themes has resolved the theme on the client. Waiting
  // for it avoids mounting the editor in one colour scheme and repainting it
  // in the other a frame later.
  const { resolvedTheme } = useTheme();

  if (!resolvedTheme) return <EditorFallback />;

  return (
    <Editor
      height="100%"
      defaultLanguage="html"
      value={value}
      onChange={(next) => onChange(next ?? '')}
      theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
      loading={<EditorFallback />}
      options={{
        // Monaco's real input is a hidden <textarea>; without this it is an
        // unnamed control to anything reading the page aloud.
        ariaLabel: 'HTML source for the document being rendered',
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: 'none',
        smoothScrolling: true,
      }}
    />
  );
}

function EditorFallback() {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      Loading editor…
    </div>
  );
}
