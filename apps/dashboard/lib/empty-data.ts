/**
 * Copy shown when a real fetch legitimately returns zero rows. These strings
 * are UX guidance — nothing in this file should be rendered without a fetch
 * behind it. The previous version of this module doubled as a static data
 * source for the dashboard shell (which is why every section rendered "no
 * projects yet" regardless of what the API held); that pattern is gone.
 *
 * Each entry has:
 *   - title:         section heading
 *   - emptyTitle:    heading shown when the fetch succeeds with zero rows
 *   - description:   supporting copy for the empty state
 */
export interface SectionCopy {
  title: string;
  emptyTitle: string;
  description: string;
}

export const sections: Record<string, SectionCopy> = {
  projects: {
    title: 'Projects',
    emptyTitle: 'No projects yet',
    description: 'Import a spec or recording to create your first project.',
  },
  graphs: {
    title: 'Graphs',
    emptyTitle: 'No behavior graphs yet',
    description: 'Ingest an API to build one.',
  },
  snapshots: {
    title: 'Snapshots',
    emptyTitle: 'No snapshots yet',
    description: 'Save runtime state when you have a test setup worth reusing.',
  },
  recordings: {
    title: 'Recordings',
    emptyTitle: 'No recordings yet',
    description: 'Run `carbon record <url>` to capture traffic.',
  },
  state: {
    title: 'State',
    emptyTitle: 'No saved state yet',
    description: 'State will appear after you start a runtime and create resources.',
  },
  keys: {
    title: 'API keys',
    emptyTitle: 'No API keys yet',
    description: 'Create keys from the API when you are ready to connect CLI or CI workflows.',
  },
  settings: {
    title: 'Settings',
    emptyTitle: 'No workspace settings yet',
    description: 'Team settings will appear after the workspace backend is connected.',
  },
  emulators: {
    title: 'Emulators',
    emptyTitle: 'No emulators running',
    description: 'Running runtime processes will appear here after they start.',
  },
  activity: {
    title: 'Activity',
    emptyTitle: 'No activity yet',
    description: 'Project events will appear here after imports, snapshots, or runs.',
  },
  'ai-quality': {
    title: 'AI quality',
    emptyTitle: 'No AI quality reports yet',
    description: 'Groundedness scores for each AI-inferred spec ingest. Run `carbon ingest` to generate a quality report.',
  },
  'chaos-presets': {
    title: 'Chaos presets',
    emptyTitle: 'No chaos presets yet',
    description: 'Presets bundle latency and error injection rules you can apply to any running emulator to simulate failure modes.',
  },
  usage: {
    title: 'Usage',
    emptyTitle: 'No usage recorded',
    description: 'Metered events (ingests, AI calls, emulator runs) will appear here once you start using the API.',
  },
  'feature-flags': {
    title: 'Feature flags',
    emptyTitle: 'No feature flags yet',
    description: 'Feature flags gate experimental behaviour across the dashboard, emulator, and CLI. Override values per org here.',
  },
} as const;

export type SectionSlug = keyof typeof sections;

export function isSectionSlug(value: string): value is SectionSlug {
  return value in sections;
}

/**
 * Returns the section copy for `slug`, or `undefined` if the slug is not a
 * known section. Consumers must only render this after their fetch actually
 * returned zero rows.
 */
export function getSectionCopy(slug: string): SectionCopy | undefined {
  return sections[slug];
}
