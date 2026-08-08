'use client';

import { EmptyState } from '@/components/ui';
import { getSectionCopy } from '@/lib/empty-data';

/**
 * Recordings do not have a dedicated route on `apps/api` yet — HAR/traffic
 * capture is only accessible through the CLI. Rather than fabricate rows,
 * we show the honest "not available yet" state until a `/v1/recordings`
 * (or an artifacts kind='recording') endpoint lands.
 */
export default function RecordingsSection() {
  const copy = getSectionCopy('recordings')!;
  return (
    <EmptyState badge="Not available yet" title={copy.emptyTitle} description={copy.description} />
  );
}
