import { notFound } from 'next/navigation';
import { Topbar } from '@/components/topbar';
import { isSectionSlug, sections } from '@/lib/empty-data';
import ProjectsSection from './_sections/projects';
import SnapshotsSection from './_sections/snapshots';
import EmulatorsSection from './_sections/emulators';
import KeysSection from './_sections/keys';
import GraphsSection from './_sections/graphs';
import RecordingsSection from './_sections/recordings';
import StateSection from './_sections/state';
import ActivitySection from './_sections/activity';
import SettingsSection from './_sections/settings';
import AiQualitySection from './_sections/ai-quality';
import UsageSection from './_sections/usage';
import ChaosPresetsSection from './_sections/chaos-presets';
import FeatureFlagsSection from './_sections/feature-flags';
import JobsSection from './_sections/jobs';

export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}

/**
 * Router page for every non-overview dashboard section. Dispatches to a
 * per-section client component under `_sections/`. Each section owns its
 * own fetching, loading/error UI, and mutations.
 */
export default async function DashboardSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isSectionSlug(section)) notFound();

  const copy = sections[section];

  return (
    <>
      <Topbar title={copy?.title ?? section} />
      <main className="space-y-6 p-8">{renderSection(section)}</main>
    </>
  );
}

function renderSection(slug: string) {
  switch (slug) {
    case 'projects':
      return <ProjectsSection />;
    case 'snapshots':
      return <SnapshotsSection />;
    case 'emulators':
      return <EmulatorsSection />;
    case 'keys':
      return <KeysSection />;
    case 'graphs':
      return <GraphsSection />;
    case 'recordings':
      return <RecordingsSection />;
    case 'state':
      return <StateSection />;
    case 'activity':
      return <ActivitySection />;
    case 'settings':
      return <SettingsSection />;
    case 'ai-quality':
      return <AiQualitySection />;
    case 'usage':
      return <UsageSection />;
    case 'chaos-presets':
      return <ChaosPresetsSection />;
    case 'feature-flags':
      return <FeatureFlagsSection />;
    case 'jobs':
      return <JobsSection />;
    default:
      return null;
  }
}
