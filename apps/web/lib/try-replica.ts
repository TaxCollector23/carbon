/**
 * Pure, deterministic state machine backing the marketing-site `/try`
 * playground. This is the same behaviour `carbon emulate` gives you against a
 * real spec — a stateful resource store that persists mutations across
 * requests — but reduced to a dependency-free module so the reducer itself is
 * unit-testable and the UI stays a thin shell over it.
 */

export type Method = 'GET' | 'POST' | 'DELETE';

export interface Pet {
  id: string;
  name: string;
  status: string;
}

export interface ReplicaRequest {
  method: Method;
  path: string;
  /** Raw JSON body for mutating requests. */
  body?: string;
}

export interface ReplicaResponse {
  status: number;
  body: unknown;
}

export interface ReplicaState {
  pets: Pet[];
  /** Monotonic id counter so ids are never reused within a session. */
  nextId: number;
  /** Captured snapshot; `null` means "no snapshot yet". */
  snapshot: Pet[] | null;
}

const INITIAL_PETS: readonly Pet[] = [{ id: 'pet_1', name: 'Carbon cat', status: 'available' }];

export function createInitialState(): ReplicaState {
  return { pets: [...INITIAL_PETS], nextId: 2, snapshot: null };
}

/**
 * Capture the current resource set. Restoring later rolls the store back to
 * exactly this list — the determinism story that differentiates Carbon from
 * static mocks.
 */
export function takeSnapshot(state: ReplicaState): ReplicaState {
  return { ...state, snapshot: [...state.pets] };
}

export function restoreSnapshot(state: ReplicaState): ReplicaState {
  if (state.snapshot === null) return state;
  return { ...state, pets: [...state.snapshot] };
}

export function executeRequest(
  state: ReplicaState,
  request: ReplicaRequest,
): { state: ReplicaState; response: ReplicaResponse } {
  const { method, path } = request;
  const last = state.pets.at(-1);

  if (method === 'GET' && path === '/pets') {
    return {
      state,
      response: {
        status: 200,
        body: { data: state.pets, count: state.pets.length },
      },
    };
  }

  if (method === 'POST' && path === '/pets') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body ?? '{}');
    } catch {
      return {
        state,
        response: { status: 400, body: { error: 'POST /pets needs a JSON body.' } },
      };
    }

    const input = parsed as { name?: unknown; status?: unknown };
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      return {
        state,
        response: {
          status: 400,
          body: { error: 'POST /pets needs a JSON body with a non-empty `name`.' },
        },
      };
    }

    const pet: Pet = {
      id: `pet_${state.nextId}`,
      name: input.name.trim(),
      status: typeof input.status === 'string' ? input.status : 'available',
    };
    return {
      state: { ...state, pets: [...state.pets, pet], nextId: state.nextId + 1 },
      response: { status: 201, body: pet },
    };
  }

  if (method === 'GET' && path === '/pets/{id}') {
    if (!last) {
      return {
        state,
        response: { status: 404, body: { error: 'No pets exist. Create one first.' } },
      };
    }
    return { state, response: { status: 200, body: last } };
  }

  if (method === 'DELETE' && path === '/pets/{id}') {
    if (!last) {
      return {
        state,
        response: { status: 404, body: { error: 'No pets exist. Create one first.' } },
      };
    }
    const remaining = state.pets.slice(0, -1);
    return {
      state: { ...state, pets: remaining },
      response: {
        status: 200,
        body: { deleted: last.id, remaining: remaining.length },
      },
    };
  }

  return {
    state,
    response: { status: 404, body: { error: `No route for ${method} ${path}` } },
  };
}
