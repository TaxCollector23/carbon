/**
 * Process lifecycle state, shared between the signal handler and `/ready`.
 *
 * The ordering that matters on a rolling deploy is: mark the process
 * draining → keep serving inflight and newly-arriving requests → let the load
 * balancer observe a failing `/ready` and stop routing → *then* close the
 * server. Closing the listener first is the common mistake: connections in
 * flight at the LB get a connection reset, which surfaces to users as 502s
 * during every deploy.
 */
export interface Lifecycle {
  readonly draining: boolean;
  /** Milliseconds since `beginDrain()`, or 0 if not draining. */
  drainingForMs(): number;
  beginDrain(): void;
}

export function createLifecycle(): Lifecycle {
  let drainStartedAt: number | null = null;
  return {
    get draining() {
      return drainStartedAt !== null;
    },
    drainingForMs: () => (drainStartedAt === null ? 0 : Date.now() - drainStartedAt),
    beginDrain: () => {
      drainStartedAt ??= Date.now();
    },
  };
}

/** A lifecycle that never drains — the default for tests and embedded use. */
export const AlwaysReady: Lifecycle = {
  draining: false,
  drainingForMs: () => 0,
  beginDrain: () => {},
};
