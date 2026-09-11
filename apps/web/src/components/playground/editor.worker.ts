// Worker entry points must be modules the bundler can resolve from a relative
// URL: `new URL('monaco-editor/...', import.meta.url)` leaves a bare specifier
// that Turbopack will not follow. These one-line shims give it a real file.
//
// The specifier has no `esm/vs` prefix on purpose — monaco's exports map
// rewrites `monaco-editor/*` to `./esm/vs/*.js` already.
import 'monaco-editor/editor/editor.worker.js';
