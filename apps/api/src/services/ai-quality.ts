import { makeId } from '@carbon/core';
import { schema } from '@carbon/database';
import type { JudgeIssue, JudgeVerdict } from '@carbon/ai';
import type { AppContext } from '../context.js';
import { recordAiJudgeBelowThreshold } from '../plugins/metrics.js';

/**
 * Persist an AI judge verdict pair against a project. Every ingest with the
 * judge enabled writes one row so the dashboard's AI-quality view (and the
 * enterprise CSV export) can query per-project scores and open issues without
 * dereferencing the storage blob.
 *
 * The caller receives the assigned id, the derived `minScore`, and whether
 * the report tripped the review gate — enough to log or emit an event
 * downstream without having to re-parse the verdicts.
 */
export interface RecordAiQualityReportInput {
  readonly projectId: string;
  readonly irKey?: string | null;
  readonly verdicts: {
    readonly resources: JudgeVerdict;
    readonly relationships: JudgeVerdict;
  };
  readonly threshold: number;
}

export interface RecordedAiQualityReport {
  readonly id: string;
  readonly minScore: number;
  readonly needsReview: boolean;
}

interface TaggedIssue extends JudgeIssue {
  readonly pass: 'resources' | 'relationships';
}

export async function recordAiQualityReport(
  ctx: AppContext,
  input: RecordAiQualityReportInput,
): Promise<RecordedAiQualityReport> {
  const { resources, relationships } = input.verdicts;
  const minScore = Math.min(resources.score, relationships.score);
  const needsReview = minScore < input.threshold;
  const issues: TaggedIssue[] = [
    ...resources.issues.map((i) => ({ ...i, pass: 'resources' as const })),
    ...relationships.issues.map((i) => ({ ...i, pass: 'relationships' as const })),
  ];
  const id = makeId('aiq');
  // Model is a free-form string on the schema (nullable). Prefer the resource
  // pass model; fall back to relationship pass. Fallback verdicts leave both
  // undefined and we simply store null.
  const model = resources.model ?? relationships.model ?? null;
  await ctx.db.insert(schema.aiQualityReports).values({
    id,
    projectId: input.projectId,
    irKey: input.irKey ?? null,
    resourcesScore: resources.score.toFixed(4),
    relationshipsScore: relationships.score.toFixed(4),
    minScore: minScore.toFixed(4),
    issues,
    needsReview,
    model,
  });
  if (needsReview) recordAiJudgeBelowThreshold();
  return { id, minScore, needsReview };
}
