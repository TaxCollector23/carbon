import type { Logger, ReliabilityRun, ReliabilityScenario, ReliabilityScenarioId } from '@carbon/core';
import {
  RELIABILITY_SCENARIOS,
  makeId,
  NotFoundError,
  InvalidInputError,
  reliabilityScenario,
} from '@carbon/core';
import { diffSnapshots, type StateSnapshot } from '@carbon/state';
import { StorageKeys, type Storage } from '@carbon/storage';
import type { EmulatorRegistry } from './emulator-registry.js';

export interface ReliabilityRunInput {
  readonly emulatorId: string;
  readonly scenario: ReliabilityScenarioId;
  readonly method?: string;
  readonly path?: string;
  readonly body?: unknown;
  readonly expectedStatus?: number;
  readonly timeoutMs?: number;
}

export interface ReliabilityService {
  readonly scenarios: () => readonly ReliabilityScenario[];
  readonly run: (input: ReliabilityRunInput) => Promise<ReliabilityRun>;
  readonly list: (projectSlug?: string, limit?: number) => Promise<ReliabilityRun[]>;
  readonly get: (id: string, projectSlug?: string) => Promise<ReliabilityRun>;
  readonly rerun: (id: string, projectSlug?: string) => Promise<ReliabilityRun>;
}

const MAX_BODY_CHARS = 8_000;
const MAX_RESPONSE_CHARS = 4_000;
const DEFAULT_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

export function createReliabilityService(deps: {
  readonly emulators: EmulatorRegistry;
  readonly storage: Storage;
  readonly logger: Logger;
}): ReliabilityService {
  const scenarios = () => RELIABILITY_SCENARIOS;

  async function run(input: ReliabilityRunInput): Promise<ReliabilityRun> {
    const record = deps.emulators.get(input.emulatorId);
    const scenario = reliabilityScenario(input.scenario);
    if (!scenario) throw new InvalidInputError(`Unknown reliability scenario: ${input.scenario}`);

    const method = (input.method ?? scenario.defaultMethod).toUpperCase();
    if (!/^[A-Z]+$/.test(method)) throw new InvalidInputError('method must contain letters only');
    const path = input.path ?? scenario.defaultPath;
    if (!path.startsWith('/') || path.startsWith('//') || path.length > 2_000) {
      throw new InvalidInputError('path must be a relative path beginning with /');
    }
    const timeoutMs = clamp(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 100, MAX_TIMEOUT_MS);
    const expectedStatus = input.expectedStatus ?? scenario.defaultExpectedStatus;
    const requestBody = boundedValue(input.body, MAX_BODY_CHARS);
    const request = { method, path, ...(requestBody === undefined ? {} : { body: requestBody }), timeoutMs };
    const before = await deps.emulators.getStateSnapshot(record.id);
    const createdAt = new Date().toISOString();
    const startedAt = Date.now();
    const steps: Array<{
      name: string;
      status: 'passed' | 'failed' | 'skipped';
      detail: string;
      durationMs?: number;
    }> = [];
    const observed: Array<{
      status: number | null;
      responseBody?: unknown;
      latencyMs: number;
      error?: string;
    }> = [];
    const fault = buildFault(scenario, timeoutMs, expectedStatus);

    try {
      deps.emulators.applyChaos(record.id, chaosFor(fault, method, path));
      steps.push({ name: 'configure fault', status: 'passed', detail: fault.description });

      const target = `${record.url}${path}`;
      const first = await requestOnce(target, request, timeoutMs);
      observed.push(first);
      steps.push({
        name: 'execute request',
        status: first.error ? 'failed' : 'passed',
        detail: first.error ?? `HTTP ${first.status ?? 'no response'} in ${first.latencyMs}ms`,
        durationMs: first.latencyMs,
      });

      if (scenario.id === 'duplicate-webhook' || scenario.id === 'inconsistent-source') {
        const second = await requestOnce(target, request, timeoutMs);
        observed.push(second);
        steps.push({
          name: scenario.id === 'duplicate-webhook' ? 'replay delivery' : 'repeat read',
          status: second.error ? 'failed' : 'passed',
          detail: second.error ?? `HTTP ${second.status ?? 'no response'} in ${second.latencyMs}ms`,
          durationMs: second.latencyMs,
        });
      }

      const after = await deps.emulators.getStateSnapshot(record.id);
      const comparison = compareRun(scenario, before, after, observed, expectedStatus);
      steps.push({
        name: 'compare state',
        status: comparison.passed ? 'passed' : 'failed',
        detail: comparison.actual,
      });

      const completedAt = new Date().toISOString();
      const result: ReliabilityRun = {
        id: makeId('run'),
        emulatorId: record.id,
        projectSlug: record.projectSlug,
        scenario,
        status: comparison.passed ? 'passed' : 'failed',
        createdAt,
        completedAt,
        durationMs: Date.now() - startedAt,
        request,
        fault,
        observed,
        stateBefore: summarize(before),
        stateAfter: summarize(after),
        comparison,
        steps,
        reproduction: reproductionCommand(scenario.id, record.id, request),
      };
      await saveRun(deps.storage, result);
      deps.logger.info('reliability.run_complete', {
        id: result.id,
        scenario: scenario.id,
        status: result.status,
        durationMs: result.durationMs,
      });
      return result;
    } catch (err) {
      const completedAt = new Date().toISOString();
      const message = err instanceof Error ? err.message : String(err);
      const after = await deps.emulators.getStateSnapshot(record.id).catch(() => before);
      const comparison = compareRun(scenario, before, after, observed, expectedStatus);
      const result: ReliabilityRun = {
        id: makeId('run'),
        emulatorId: record.id,
        projectSlug: record.projectSlug,
        scenario,
        status: 'error',
        createdAt,
        completedAt,
        durationMs: Date.now() - startedAt,
        request,
        fault,
        observed,
        stateBefore: summarize(before),
        stateAfter: summarize(after),
        comparison,
        steps: [...steps, { name: 'runner', status: 'failed', detail: message }],
        reproduction: reproductionCommand(scenario.id, record.id, request),
        error: message,
      };
      await saveRun(deps.storage, result);
      deps.logger.warn('reliability.run_error', { id: result.id, message });
      return result;
    } finally {
      // Chaos is scoped to this run. Restore the captured baseline even when
      // the app threw or the request timed out, so reruns remain comparable.
      deps.emulators.applyChaos(record.id, { errorRules: [], latency: {} });
      await deps.emulators.restoreStateSnapshot(record.id, before).catch(() => undefined);
    }
  }

  async function list(projectSlug?: string, limit = 50): Promise<ReliabilityRun[]> {
    const prefix = projectSlug ? StorageKeys.reliabilityRuns(projectSlug) : 'projects/';
    const found: ReliabilityRun[] = [];
    for await (const object of deps.storage.list(prefix)) {
      if (!object.key.includes('/reliability/runs/')) continue;
      const bytes = await deps.storage.get(object.key);
      if (!bytes) continue;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as ReliabilityRun;
        if (parsed.id && parsed.scenario) found.push(parsed);
      } catch {
        // Ignore a corrupt historical report; a later run should still render.
      }
    }
    return found.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async function get(id: string, projectSlug?: string): Promise<ReliabilityRun> {
    if (projectSlug) {
      const bytes = await deps.storage.get(StorageKeys.reliabilityRun(projectSlug, id));
      if (bytes) return JSON.parse(new TextDecoder().decode(bytes)) as ReliabilityRun;
    } else {
      const match = await list(undefined, 500);
      const found = match.find((run) => run.id === id);
      if (found) return found;
    }
    throw new NotFoundError('reliability run', id);
  }

  async function rerun(id: string, projectSlug?: string): Promise<ReliabilityRun> {
    const previous = await get(id, projectSlug);
    return run({
      emulatorId: previous.emulatorId,
      scenario: previous.scenario.id,
      method: previous.request.method,
      path: previous.request.path,
      body: previous.request.body,
      expectedStatus: previous.scenario.defaultExpectedStatus,
      timeoutMs: previous.request.timeoutMs,
    });
  }

  return { scenarios, run, list, get, rerun };
}

function buildFault(
  scenario: ReliabilityScenario,
  timeoutMs: number,
  expectedStatus: number | undefined,
) {
  if (scenario.expected === 'timeout') {
    return {
      kind: 'timeout' as const,
      description: `Delay the response beyond ${timeoutMs}ms.`,
      delayMs: timeoutMs + 250,
    };
  }
  if (scenario.expected === 'stable-response' || scenario.expected === 'single-write') {
    return { kind: 'replay' as const, description: scenario.fault };
  }
  const status = expectedStatus ?? scenario.defaultExpectedStatus ?? 503;
  return { kind: 'status' as const, description: `Return ${status} on the selected request.`, status };
}

function chaosFor(
  fault: ReturnType<typeof buildFault>,
  method: string,
  path: string,
): { errorRules?: readonly import('@carbon/runtime').ErrorInjectionRule[]; latency?: import('@carbon/runtime').LatencyProfile } {
  if (fault.kind === 'timeout') {
    return {
      latency: { floorMs: fault.delayMs, deterministic: true },
      errorRules: [],
    };
  }
  if (fault.kind === 'status') {
    return {
      errorRules: [
        {
          match: { method, path: path.split('?')[0] ?? path },
          probability: 1,
          action: { kind: 'status', status: fault.status },
        },
      ],
      latency: {},
    };
  }
  return { errorRules: [], latency: {} };
}

async function requestOnce(
  target: string,
  request: { method: string; path: string; body?: unknown; timeoutMs: number },
  timeoutMs: number,
) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, {
      method: request.method,
      headers: request.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      status: response.status,
      responseBody: parseBoundedJson(text),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'AbortError';
    return {
      status: null,
      latencyMs: Date.now() - started,
      error: timeout ? `request timed out after ${timeoutMs}ms` : errorMessage(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function compareRun(
  scenario: ReliabilityScenario,
  before: StateSnapshot,
  after: StateSnapshot,
  observed: readonly { status: number | null; responseBody?: unknown; error?: string }[],
  expectedStatus: number | undefined,
): ReliabilityRun['comparison'] {
  const diff = diffSnapshots(before, after);
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const resource of Object.values(diff.resources)) {
    added += resource.added.length;
    removed += resource.removed.length;
    changed += resource.changed.length;
  }
  const persistedChange = added + removed + changed > 0;
  const first = observed[0];
  let passed = false;
  let expected = scenario.fault;
  let actual = `state delta +${added}/-${removed}/~${changed}`;
  if (scenario.expected === 'timeout') {
    passed = Boolean(first?.error);
    expected = 'request should time out';
    actual = first?.error ?? `HTTP ${first?.status ?? 'no response'}`;
  } else if (scenario.expected === 'stable-response') {
    const second = observed[1];
    passed = Boolean(first && second && !first.error && !second.error && first.status === second.status && JSON.stringify(first.responseBody) === JSON.stringify(second.responseBody));
    expected = 'repeated reads should match';
    actual = passed ? 'repeated responses matched' : 'repeated responses differed';
  } else if (scenario.expected === 'single-write') {
    passed = added <= 1 && removed === 0 && changed === 0;
    expected = 'duplicate delivery should create at most one record';
    actual = `duplicate delivery produced +${added}/-${removed}/~${changed}`;
  } else {
    passed = first?.status === expectedStatus && !persistedChange;
    expected = `HTTP ${expectedStatus} with no state mutation`;
    actual = `HTTP ${first?.status ?? 'no response'}; state delta +${added}/-${removed}/~${changed}`;
  }
  return { passed, expected, actual, added, removed, changed, persistedChange };
}

function summarize(snapshot: StateSnapshot): ReliabilityRun['stateBefore'] {
  const byResource = new Map<string, string[]>();
  for (const record of snapshot.records) {
    const ids = byResource.get(String(record.resource)) ?? [];
    if (ids.length < 5) ids.push(record.id);
    byResource.set(String(record.resource), ids);
  }
  return {
    recordCount: snapshot.records.length,
    resources: [...byResource.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([resource, ids]) => ({ resource, count: snapshot.records.filter((r) => String(r.resource) === resource).length, sampleIds: ids })),
  };
}

async function saveRun(storage: Storage, run: ReliabilityRun): Promise<void> {
  await storage.put(StorageKeys.reliabilityRun(run.projectSlug, run.id), JSON.stringify(run), {
    contentType: 'application/json',
  });
}

function reproductionCommand(
  scenario: ReliabilityScenarioId,
  emulatorId: string,
  request: { method: string; path: string },
): string {
  return `carbon test --emulator ${emulatorId} --scenario ${scenario} --method ${request.method} --path '${request.path}'`;
}

function boundedValue(value: unknown, maxChars: number): unknown {
  if (value === undefined) return undefined;
  const safe = redactValue(value);
  const encoded = JSON.stringify(safe);
  if (encoded.length <= maxChars) return safe;
  return { redacted: true, reason: `value exceeded ${maxChars} characters` };
}

function parseBoundedJson(text: string): unknown {
  const bounded = text.slice(0, MAX_RESPONSE_CHARS);
  try {
    return redactValue(JSON.parse(bounded));
  } catch {
    return bounded || undefined;
  }
}

const SENSITIVE_FIELDS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'access-token',
  'refresh-token',
  'password',
  'secret',
  'apikey',
  'api_key',
]);

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SENSITIVE_FIELDS.has(key.toLowerCase())
      ? '[redacted]'
      : redactValue(child, depth + 1);
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
