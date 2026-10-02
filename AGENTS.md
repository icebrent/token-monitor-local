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

- Electron main owns window/tray/settings and official usage IPC.
- Only codexAppServerClient.js may spawn the installed official Codex native
  executable, with fixed app-server stdio arguments and shell disabled.
- Token activity comes only from account/usage/read (no threadId estimates).
- Limits come only from account/rateLimits/read. Never mix local session tokens.
- Legacy parser/localPaths remain for debug and legacy tests, never production scans.
- Renderer keeps offlinePolicy.js network/CSP/permission/navigation restrictions.
- Never read, copy, log or store credentials or implement OAuth. Authentication
  and backend network access belong to official Codex CLI.
- No HTTP clients, sockets/listeners, native addons, update checks, external URLs,
  sync, hub/agent runtimes or arbitrary renderer command/path capabilities.
- No new dependencies without discussion. Keep README and security audit aligned.
