/**
 * Runs BEFORE any other imports in `index.ts`. OpenTelemetry auto-
 * instrumentation patches `http`, `fastify`, `ioredis`, `pg` on `require` /
 * `import`, so the SDK must be started before those modules are pulled in.
 *
 * Off by default — see `observability/tracing.ts`.
 */
import { startTracing } from './observability/tracing.js';

// Fire and forget. The rest of boot doesn't need to await this; the SDK is
// synchronous once `.start()` returns, and dynamic imports of the OTel
// packages happen before instrumentation registration inside `startTracing`.
await startTracing({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'carbon-api',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
