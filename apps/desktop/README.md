# @carbon/desktop

Native desktop app for Carbon, built with [Tauri v2](https://tauri.app). Point it
at an OpenAPI/AsyncAPI/GraphQL/protobuf spec and it boots a stateful local
replica via the `carbon` CLI, then live-views the runtime's `/__carbon/inspect`
surface and mutation journal.

## Prerequisites

- Rust toolchain (stable) + the Tauri platform deps for your OS
  (`https://tauri.app/start/prerequisites/`).
- The Carbon CLI on `PATH`:
  ```bash
  npm i -g carbon-api
  ```

## Run

```bash
pnpm install
pnpm --filter @carbon/desktop dev
```

## How it works

The Rust command layer (`src-tauri/src/lib.rs`) spawns `carbon emulate --from
<spec> --port <port>` as a managed child process, reads the CLI's
"Runtime ready at …" line to learn the URL, and exposes four commands to the
frontend:

- `emulate(spec, port)` — stop any running emulator, boot a new one, return its URL
- `stop()` — kill the managed child
- `inspect(url)` — `GET /__carbon/inspect`
- `history(url)` — `GET /__carbon/state/history`

All HTTP goes through Rust (via `ureq`) so the webview never has to negotiate
CORS with the local runtime. The frontend in `frontend/` is plain HTML/CSS/JS —
no bundler — and talks to Rust through Tauri's global `window.__TAURI__.core`.

## Notes

- `pnpm --filter @carbon/desktop build` produces a macOS `.app` (+ zip it for
  distribution); DMG bundling still needs the `bundle_dmg` toolchain wired up.
- A future release step should bundle the CLI as a Tauri
  [sidecar](https://v2.tauri.app/develop/sidecar/) so end users don't need npm.
- The spawned CLI is best-effort killed on Stop; quitting the app also drops
  the child on most platforms.
