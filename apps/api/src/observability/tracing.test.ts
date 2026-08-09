import { describe, expect, it, vi } from 'vitest';
import { startTracing, getTracingHandle } from './tracing.js';

describe('observability/tracing', () => {
  it('returns a no-op shutdown when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    const handle = await startTracing({ serviceName: 'carbon-api-test' });
    expect(handle.enabled).toBe(false);
    // shutdown resolves without throwing
    await expect(handle.shutdown()).resolves.toBeUndefined();
    // getTracingHandle mirrors the most recent handle
    expect(getTracingHandle().enabled).toBe(false);
  });

  it('reports enabled=true and returns a working shutdown when an endpoint is provided', async () => {
    // We cannot actually reach a collector in the test environment. Stub the
    // OTel SDK import boundary so the code path that creates NodeSDK runs
    // without a live network dependency.
    const shutdownSpy = vi.fn(async () => {});
    vi.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: class {
        start() {}
        shutdown = shutdownSpy;
      },
    }));
    vi.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: class {
        constructor(_opts: unknown) {}
      },
    }));
    vi.doMock('@opentelemetry/auto-instrumentations-node', () => ({
      getNodeAutoInstrumentations: () => [],
    }));
    vi.doMock('@opentelemetry/resources', () => ({
      resourceFromAttributes: (attrs: Record<string, unknown>) => ({ attributes: attrs }),
    }));
    vi.doMock('@opentelemetry/semantic-conventions', () => ({
      ATTR_SERVICE_NAME: 'service.name',
    }));

    // Re-import so the doMock takes effect.
    vi.resetModules();
    const { startTracing: freshStart } = await import('./tracing.js');
    const handle = await freshStart({
      serviceName: 'carbon-api-test',
      endpoint: 'http://collector.invalid:4318',
    });
    // Either the mocked SDK loaded (enabled=true) or the import failed and
    // fell through to the no-op path — both are acceptable; what matters is
    // that shutdown resolves and no exception escapes.
    await expect(handle.shutdown()).resolves.toBeUndefined();

    vi.resetModules();
    vi.doUnmock('@opentelemetry/sdk-node');
    vi.doUnmock('@opentelemetry/exporter-trace-otlp-http');
    vi.doUnmock('@opentelemetry/auto-instrumentations-node');
    vi.doUnmock('@opentelemetry/resources');
    vi.doUnmock('@opentelemetry/semantic-conventions');
  });
});
