'use client';

import { useEffect } from 'react';
import { track } from '@/lib/track';

/**
 * Global click-delegation tracker. Mount once in the root layout; any element
 * with a `data-track="action"` attribute (and optional
 * `data-track-label="..."`) fires an anonymous event on click. Keeps the
 * tracking out of every CTA's props — add an attribute, done.
 */
export function TrackDelegation() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const el = target?.closest?.('[data-track]') as HTMLElement | null;
      if (!el) return;
      const action = el.getAttribute('data-track');
      if (!action) return;
      const label = el.getAttribute('data-track-label');
      track(action, label ? { label } : undefined);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}
