'use client';

/**
 * Snapshots, artifacts, graphs, and recordings are all project-scoped on
 * the API. Until the dashboard has real routing per project, we let the
 * user pick one from a dropdown and remember the choice in localStorage
 * so navigating between sections doesn't reset it.
 */
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'carbon.selectedProjectSlug';

export function useSelectedProjectSlug(available: string[]): {
  slug: string | null;
  setSlug: (slug: string) => void;
} {
  const [slug, setSlugState] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && available.includes(stored)) {
      setSlugState(stored);
    } else if (available.length > 0 && available[0]) {
      setSlugState(available[0]);
    } else {
      setSlugState(null);
    }
  }, [available.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSlug = (next: string) => {
    setSlugState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  return { slug, setSlug };
}
