export const sections = {
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
} as const;

export type SectionSlug = keyof typeof sections;
