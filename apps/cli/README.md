# carbon-api

Stateful API replicas for development, tests, and CI.

## Install

```sh
npm install -g carbon-api
```

Zero-install:

```sh
npx carbon-api init
```

## Quick start

1. `carbon init` — scaffold a `carbon.config.ts` and `.carbon/` layout.
2. `carbon record https://api.example.com` — capture live traffic into `.carbon/recordings`.
3. `carbon ingest ./openapi.yaml` — parse specs or recordings into Carbon IR.
4. `carbon emulate --from ./openapi.yaml` — boot the deterministic local runtime on port 8787.

## Commands

| Command                         | Description                                                               |
| ------------------------------- | ------------------------------------------------------------------------- |
| `carbon init`                   | Scaffold a new Carbon project in the current directory.                   |
| `carbon record <target>`        | Observe live traffic against an upstream API.                             |
| `carbon ingest <source>`        | Parse OpenAPI, AsyncAPI, GraphQL, protobuf/gRPC, HAR, or Postman into IR. |
| `carbon emulate --from <spec>`  | Boot the local deterministic API runtime.                                 |
| `carbon inspect`                | Explore the running runtime's graph and stats.                            |
| `carbon snapshot save <name>`   | Save the current runtime state to a named snapshot.                       |
| `carbon snapshot load <name>`   | Restore a previously saved snapshot.                                      |
| `carbon snapshot list`          | List saved snapshots.                                                     |
| `carbon snapshot delete <name>` | Delete a saved snapshot.                                                  |

Run `carbon --help` or `carbon <command> --help` for full options.

## Configuration

Carbon keeps project artifacts under `.carbon/` at the repo root:

```
.carbon/
  recordings/   captured HTTP exchanges from `carbon record`
  snapshots/    named runtime state exports from `carbon snapshot save`
  state/        runtime working state for the local emulator
```

Project settings live in `carbon.config.ts` at the repo root.

## Links

- GitHub: https://github.com/TaxCollector23/carbon
- Issues: https://github.com/TaxCollector23/carbon/issues

## License

Proprietary — © Carbon.
