'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api-client';

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Minimal replacement for react-query — enough for our list/detail fetches.
 *
 * The dep list is the identity of the request. When it changes, we refetch.
 * `fn` is expected to be stable across renders (define it inline with the
 * deps in the array).
 *
 * `refetch()` re-runs the fetch without waiting for a dep change; the state
 * of the latest in-flight request wins so double clicks don't leave stale
 * errors behind.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{
    data: T | undefined;
    error: Error | null;
    loading: boolean;
  }>({
    data: undefined,
    error: null,
    loading: true,
  });
  const generation = useRef(0);

  const run = useCallback(async () => {
    const gen = ++generation.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (gen !== generation.current) return;
      setState({ data, error: null, loading: false });
    } catch (err) {
      if (gen !== generation.current) return;
      setState({
        data: undefined,
        error:
          err instanceof Error
            ? err
            : new ApiError({ status: 0, code: 'CARBON_UNKNOWN', message: String(err) }),
        loading: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void run();
    return () => {
      // Invalidate in-flight results on unmount/dep change.
      generation.current++;
    };
  }, [run]);

  return { ...state, refetch: run };
}
