# Carbon for VS Code

Emulate your API and inspect its behavior graph from inside VS Code.

## Install

Build the `.vsix` locally:

```
pnpm --filter @carbon/vscode-extension package
```

Then in VS Code: **Extensions → … menu → Install from VSIX…** and pick
`apps/vscode-extension/dist/carbon-vscode.vsix`.

## Commands

- **Carbon: Emulate current spec** — pick an OpenAPI/HAR/GraphQL/Proto spec in
  your workspace, boot a local replica via `@carbon/sdk`, and pin its URL to
  the status bar. Click the status-bar item (or run **Carbon: Stop emulator**)
  to shut it down.
- **Carbon: Inspect behavior graph** — build the IR + behavior graph and open
  a three-pane webview: resource list, force-directed SVG, JSON dump.
- **Carbon: New project** — scaffold a `carbon.config.ts` in the workspace root.
- **Carbon: View logs** — surface the emulator's output channel.

## Settings

- `carbon.apiUrl` — control-plane URL (default `http://localhost:4000`).
- `carbon.telemetry` — send anonymous usage telemetry (default `false`).
- `carbon.judgeThreshold` — minimum AI-judge score for enriched IRs
  (default `0.75`).

## Development

```
pnpm --filter @carbon/vscode-extension build      # esbuild → dist/extension.js
pnpm --filter @carbon/vscode-extension typecheck
pnpm --filter @carbon/vscode-extension test
```
