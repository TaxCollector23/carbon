# @carbon/desktop

Native desktop app for Carbon, built with [Tauri v2](https://tauri.app). Point it
at an OpenAPI/AsyncAPI/GraphQL/protobuf spec and it boots a stateful local
replica via the `carbon` CLI, then live-views the runtime's `/__carbon/inspect`
surface and mutation journal.

## Prerequisites

- Rust toolchain (stable) + the Tauri platform deps for your OS
  (`https://tauri.app/start/prerequisites/`).
- `bun` on `PATH` (used to build the bundled CLI sidecar).

## Run (dev)

```bash
pnpm install
pnpm --filter @carbon/desktop dev
```

In dev mode the CLI is resolved from `PATH` (install it with `npm i -g carbon-api`).

## Build (bundled)

```bash
pnpm --filter @carbon/desktop build
```

`build` runs `scripts/prepare-sidecar.sh` first, which builds the standalone
`carbon` CLI for your host platform and drops it into
`src-tauri/binaries/carbon-<target-triple>` — the location Tauri's bundler
expects for `bundle.externalBin`. The finished app therefore ships the CLI
inside the bundle and needs no Node/npm on the user's machine.

## How it works

The Rust command layer (`src-tauri/src/lib.rs`) resolves the CLI binary by
preferring a Tauri sidecar sitting next to the app executable and falling back
to `carbon` on `PATH`. It spawns `carbon emulate --from <spec> --port <port>` as
a managed child process, reads the CLI's "Runtime ready at …" line to learn the
URL, and exposes four commands to the frontend:

- `emulate(spec, port)` — stop any running emulator, boot a new one, return its URL
- `stop()` — kill the managed child
- `inspect(url)` — `GET /__carbon/inspect`
- `history(url)` — `GET /__carbon/state/history`

All HTTP goes through Rust (via `ureq`) so the webview never has to negotiate
CORS with the local runtime. The frontend in `frontend/` is plain HTML/CSS/JS —
no bundler — and talks to Rust through Tauri's global `window.__TAURI__.core`.

## Notes

- `pnpm --filter @carbon/desktop build` produces a macOS `.app`; zip it for
  distribution. `pnpm --filter @carbon/desktop build:dmg` additionally builds
  an installable DMG via `scripts/make-dmg.sh`, which uses `hdiutil` only — no
  Finder AppleScript — so it also works in headless/CI environments where
  Tauri's built-in `create-dmg` step fails with "Not authorized to send Apple
  events to Finder".
- Cross-compiling for another OS: pass a Bun target to the sidecar script
  (`./scripts/prepare-sidecar.sh bun-linux-x64`) and build the app on that
  platform. The release workflow builds the desktop bundle per-OS.
- The spawned CLI is best-effort killed on Stop; quitting the app also drops
  the child on most platforms.
