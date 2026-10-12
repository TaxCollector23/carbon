/**
 * Shared vocabulary for Carbon's reliability workflow.
 *
 * These types deliberately stay independent of HTTP and the runtime package so
 * the API, CLI, and dashboard can agree on the report shape without creating a
 * dependency cycle.
 */

export const RELIABILITY_SCENARIO_IDS = [
  'http-outage',
  'rate-limit',
  'timeout',
  'duplicate-webhook',
  'expired-auth',
  'interrupted-pagination',
  'inconsistent-source',
  'partial-sync',
] as const;

export type ReliabilityScenarioId = (typeof RELIABILITY_SCENARIO_IDS)[number];

export interface ReliabilityScenario {
  readonly id: ReliabilityScenarioId;
  readonly title: string;
  readonly summary: string;
  readonly fault: string;
  readonly defaultMethod: string;
  readonly defaultPath: string;
  readonly expected: 'status' | 'timeout' | 'stable-response' | 'single-write';
  readonly defaultExpectedStatus?: number;
}

export const RELIABILITY_SCENARIOS: readonly ReliabilityScenario[] = [
  {
    id: 'http-outage',
    title: 'HTTP outage',
    summary: 'Prove a downstream 503 does not corrupt local state.',
    fault: 'Return 503 on the selected request.',
    defaultMethod: 'GET',
    defaultPath: '/health',
    expected: 'status',
    defaultExpectedStatus: 503,
  },
  {
    id: 'rate-limit',
    title: 'Rate limit',
    summary: 'Exercise a 429 and verify the caller can retry safely.',
    fault: 'Return 429 on the selected request.',
    defaultMethod: 'GET',
    defaultPath: '/health',
    expected: 'status',
    defaultExpectedStatus: 429,
  },
  {
    id: 'timeout',
    title: 'Timeout',
    summary: 'Hold a dependency open and make the client deadline visible.',
    fault: 'Delay the response beyond the configured deadline.',
    defaultMethod: 'GET',
    defaultPath: '/health',
    expected: 'timeout',
  },
  {
    id: 'duplicate-webhook',
    title: 'Duplicate webhook',
    summary: 'Send the same delivery twice and inspect duplicate writes.',
    fault: 'Replay the same request with the same payload twice.',
    defaultMethod: 'POST',
    defaultPath: '/webhooks/events',
    expected: 'single-write',
  },
  {
    id: 'expired-auth',
    title: 'Expired auth',
    summary: 'Return 401 and confirm the failed request leaves state untouched.',
    fault: 'Return 401 on the selected request.',
    defaultMethod: 'GET',
    defaultPath: '/health',
    expected: 'status',
    defaultExpectedStatus: 401,
  },
  {
    id: 'interrupted-pagination',
    title: 'Interrupted pagination',
    summary: 'Interrupt a page fetch and verify the partial page is not committed.',
    fault: 'Return 503 while fetching the selected page.',
    defaultMethod: 'GET',
    defaultPath: '/items?page=2',
    expected: 'status',
    defaultExpectedStatus: 503,
  },
  {
    id: 'inconsistent-source',
    title: 'Inconsistent source',
    summary: 'Read the same source twice and compare its observable response.',
    fault: 'Repeat the request and compare status and response body.',
    defaultMethod: 'GET',
    defaultPath: '/items',
    expected: 'stable-response',
  },
  {
    id: 'partial-sync',
    title: 'Partial sync',
    summary: 'Fail the sync boundary and confirm partial writes are detectable.',
    fault: 'Return 503 at the sync boundary.',
    defaultMethod: 'POST',
    defaultPath: '/sync',
    expected: 'status',
    defaultExpectedStatus: 503,
  },
] as const;

export type ReliabilityRunStatus = 'passed' | 'failed' | 'error';
export type ReliabilityStepStatus = 'passed' | 'failed' | 'skipped';

export interface ReliabilityRequest {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly timeoutMs: number;
}

export interface ReliabilityObservedRequest {
  readonly status: number | null;
  readonly responseBody?: unknown;
  readonly latencyMs: number;
  readonly error?: string;
}

export interface ReliabilityStateSummary {
  readonly recordCount: number;
  readonly resources: ReadonlyArray<{
    readonly resource: string;
    readonly count: number;
    readonly sampleIds: readonly string[];
  }>;
}

export interface ReliabilityComparison {
  readonly passed: boolean;
  readonly expected: string;
  readonly actual: string;
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  readonly persistedChange: boolean;
}

export interface ReliabilityStep {
  readonly name: string;
  readonly status: ReliabilityStepStatus;
  readonly detail: string;
  readonly durationMs?: number;
}

export interface ReliabilityFault {
  readonly kind: 'status' | 'timeout' | 'replay' | 'comparison';
  readonly description: string;
  readonly status?: number;
  readonly delayMs?: number;
}

export interface ReliabilityRun {
  readonly id: string;
  readonly emulatorId: string;
  readonly projectSlug: string;
  readonly scenario: ReliabilityScenario;
  readonly status: ReliabilityRunStatus;
  readonly createdAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly request: ReliabilityRequest;
  readonly fault: ReliabilityFault;
  readonly observed: readonly ReliabilityObservedRequest[];
  readonly stateBefore: ReliabilityStateSummary;
  readonly stateAfter: ReliabilityStateSummary;
  readonly comparison: ReliabilityComparison;
  readonly steps: readonly ReliabilityStep[];
  readonly reproduction: string;
  readonly error?: string;
}

export function reliabilityScenario(id: string): ReliabilityScenario | undefined {
  return RELIABILITY_SCENARIOS.find((scenario) => scenario.id === id);
}
