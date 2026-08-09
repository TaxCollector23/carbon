/**
 * OpenTelemetry bootstrap for the API. Entirely opt-in: when
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, `startTracing()` returns a no-op
 * shutdown and no OTel packages are loaded. This preserves the fast-boot path
 * for dev / self-hosted operators who do not run a collector.
 *
 * Auto-instrumentation for HTTP, Fastify, ioredis, and pg is registered before
 * those modules are `require`d — callers MUST invoke `startTracing()` before
 * importing Fastify, ioredis, pg, etc. In this app that's done from
 * `preload.ts`, which `index.ts` imports first.
 */
export interface StartTracingOptions {
  readonly serviceName: string;
  /** OTLP HTTP endpoint (e.g. http://tempo:4318 or https://api.honeycomb.io). */
  readonly endpoint?: string;
  /** Extra headers for the exporter — vendor auth tokens live here. */
  readonly headers?: Record<string, string>;
}

export interface TracingHandle {
  /** Flush and shut down the tracer provider. Always resolves; safe to call multiple times. */
  shutdown: () => Promise<void>;
  /** True when a real exporter is wired; false for the no-op path. */
  enabled: boolean;
}

let current: TracingHandle | undefined;

/**
 * Boot the OpenTelemetry SDK. Off unless an OTLP endpoint is provided so the
 * fast-boot path stays cost-free for operators who don't run a collector.
 */
export async function startTracing(opts: StartTracingOptions): Promise<TracingHandle> {
  const endpoint = opts.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    const handle: TracingHandle = { shutdown: async () => {}, enabled: false };
    current = handle;
    return handle;
  }

  // Deferred imports keep the OTel package graph off the hot path when tracing
  // is disabled (which is the default). A missing peer here surfaces as a
  // logged warning rather than a boot failure.
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { getNodeAutoInstrumentations } = await import(
      '@opentelemetry/auto-instrumentations-node'
    );
    const { resourceFromAttributes } = await import('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions');

    const exporter = new OTLPTraceExporter({
      url: endpoint.replace(/\/+$/, '') + '/v1/traces',
      headers: opts.headers,
    });

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: opts.serviceName,
      }),
      traceExporter: exporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          // These are the ones we actually care about; disable the noisy
          // filesystem instrumentation which spans every fs.readFile.
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    sdk.start();

    const handle: TracingHandle = {
      enabled: true,
      shutdown: async () => {
        try {
          await sdk.shutdown();
        } catch {
          // Never let telemetry teardown block process exit.
        }
      },
    };
    current = handle;
    return handle;
  } catch (err) {
    // Missing OTel packages, exporter errors, etc. — log to stderr rather than
    // crashing. Tracing is observability, not a hard dependency.
    // eslint-disable-next-line no-console
    console.warn(
      'carbon: OpenTelemetry setup failed — continuing without tracing:',
      err instanceof Error ? err.message : err,
    );
    const handle: TracingHandle = { shutdown: async () => {}, enabled: false };
    current = handle;
    return handle;
  }
}

/**
 * Retrieve the handle set by the most recent `startTracing()` call. Used by
 * the boot sequence: `preload.ts` starts tracing; `index.ts` reads back the
 * shutdown hook to run it on SIGTERM/SIGINT.
 */
export function getTracingHandle(): TracingHandle {
  return current ?? { shutdown: async () => {}, enabled: false };
}
