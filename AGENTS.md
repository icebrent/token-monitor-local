# AGENTS.md

## Language and Git

- Communicate with the user in Simplified Chinese.
- Use concise English conventional commit messages: `<type>(<scope>): <subject>`.
- Verify the exact staged scope before each commit. Do not add AI co-author trailers.

## Commands

```bash
npm start       # launch the local Electron widget
npm test        # node:test suite
npm run lint    # ESLint
npm run verify  # lint + tests
npm run pack    # unpacked platform build in dist/
```

Node.js 22.13 or newer is required.

## Architecture and invariants

- `src/electron/main.js` owns the window, tray, fixed Codex root, local watcher,
  settings, exports, and IPC.
- `src/electron/offlinePolicy.js` owns request cancellation, permission denial,
  CSP response headers, and navigation/window/webview restrictions.
- `src/shared/localPaths.js` canonicalizes `${CODEX_HOME:-~/.codex}` once and
  fixes its `sessions` child as the only scan root.
- `src/shared/codexJsonlParser.js` reads regular JSONL files without following
  symlinks or junctions and performs cumulative token accounting.
- `src/shared/exporter.js` serializes the current local snapshot to fixed
  JSON/CSV filenames.
- The renderer receives no arbitrary scan-root or open-path capability.

The runtime must remain offline. Do not add HTTP clients, sockets, listeners,
child processes, native addons, OAuth, credentials, provider APIs, update
checks, external URLs, sync, hub/agent runtimes, or additional AI-tool scan
roots. `webRequest` and CSP are defense in depth; physical absence of network
and process-capable code is the primary guarantee.

Do not add dependencies without discussing the need first. Keep README file
boundaries and the automated offline audit aligned with any intentional change.
