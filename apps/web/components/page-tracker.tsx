'use client';

import { useEffect } from 'react';
import { track } from '@/lib/track';

/**
 * Fire one anonymous page-view event on mount. Rendered by server components
 * (e.g. the /try page) that want a "view" signal without becoming client
 * components themselves.
 */
export function PageTracker({ action }: { action: string }) {
  useEffect(() => {
    track(action);
  }, [action]);
  return null;
}
