import { z } from 'zod';
import type {
  IntermediateRepresentation,
  RelationshipDef,
  ResourceDef,
} from '@carbon/types';
import type { AiProvider } from './provider.js';

/**
 * The AI Judge is an adversarial second pass over the first-pass inference
 * output. Its purpose is to catch hallucinated resources, invented fields,
 * and unsupported relationships before they land in a project's IR and get
 * baked into a runtime replica.
 *
 * The judge is intentionally paranoid — it should over-flag rather than
 * miss issues. Downstream code (the ingest worker) uses the numeric score to
 * gate whether the job auto-completes or lands in the `needs_review` state
 * so a human can approve.
 */

export type JudgeIssueSeverity = 'info' | 'warn' | 'error';

export interface JudgeIssue {
  readonly targetType: 'resource' | 'field' | 'primaryKey' | 'relationship';
  readonly targetId: string;
  readonly reason: string;
  readonly severity: JudgeIssueSeverity;
}

export interface JudgeVerdict {
  /** 0..1 confidence that the inference is well-grounded in the IR. */
  readonly score: number;
  readonly issues: readonly JudgeIssue[];
  /** Model identifier if the verdict came from a provider; undefined for fallback. */
  readonly model?: string;
}

/** Aliases matching the Phase B plan's terminology. */
export type BehaviorIR = IntermediateRepresentation;
export type Resource = ResourceDef;
export type Relationship = RelationshipDef;

const JudgeIssueSchema = z.object({
  targetType: z.enum(['resource', 'field', 'primaryKey', 'relationship']),
  targetId: z.string().min(1),
  reason: z.string().min(1),
  severity: z.enum(['info', 'warn', 'error']),
});

const JudgeVerdictSchema = z.object({
  score: z.number().min(0).max(1),
  issues: z.array(JudgeIssueSchema),
  model: z.string().optional(),
});

const RESOURCE_INSTRUCTION = [
  'You are an adversarial reviewer for an API-modeling pipeline.',
  'Your job is to find issues; err on the side of flagging.',
  'You are given (a) a Behavior IR describing API endpoints and (b) a set of',
  'proposedResources produced by a first-pass inference over that IR. Judge',
  'whether each proposed resource, its fields, and its primaryKey are actually',
  'supported by the IR (endpoint paths, request/response schemas, examples).',
  'Flag anything that looks invented, unsupported, or misnamed. Prefer more',
  'issues over fewer. A hallucinated field or primaryKey is a hard error.',
  'Return strict JSON: { "score": <0..1>, "issues": [{ "targetType", "targetId", "reason", "severity" }], "model"?: string }.',
  'Score meaning: 1.0 = fully grounded, 0.75 = mostly good with minor concerns,',
  '0.5 = mixed, <0.5 = substantial hallucination. Do not emit prose outside JSON.',
].join(' ');

const RELATIONSHIP_INSTRUCTION = [
  'You are an adversarial reviewer for an API-modeling pipeline.',
  'Your job is to find issues; err on the side of flagging.',
  'You are given (a) a Behavior IR and (b) a set of proposedRelationships.',
  'Verify that each proposed relationship connects two resources that actually',
  'appear in the IR (endpoints or resources list) and that the "via" field is',
  'plausible given the endpoint paths. Flag relationships whose from/to do not',
  'correspond to any endpoint or resource. Prefer more issues over fewer.',
  'Return strict JSON: { "score": <0..1>, "issues": [{ "targetType", "targetId", "reason", "severity" }], "model"?: string }.',
  'Do not emit prose outside JSON.',
].join(' ');

export interface AiJudgeOptions {
  readonly provider: AiProvider;
  /** Minimum score considered acceptable. Defaults to 0.75. */
  readonly threshold?: number;
}

export class AiJudge {
  private readonly provider: AiProvider;
  readonly threshold: number;

  constructor(opts: AiJudgeOptions) {
    this.provider = opts.provider;
    this.threshold = opts.threshold ?? 0.75;
  }

  async judgeResourceInference(input: {
    ir: BehaviorIR;
    docs?: string;
    proposedResources: readonly Resource[];
  }): Promise<JudgeVerdict> {
    return this.run(RESOURCE_INSTRUCTION, input);
  }

  async judgeRelationshipInference(input: {
    ir: BehaviorIR;
    proposedRelationships: readonly Relationship[];
  }): Promise<JudgeVerdict> {
    return this.run(RELATIONSHIP_INSTRUCTION, input);
  }

  private async run(instruction: string, input: unknown): Promise<JudgeVerdict> {
    try {
      const verdict = await this.provider.structured<JudgeVerdict>({
        instruction,
        input,
        schema: JudgeVerdictSchema as z.ZodType<JudgeVerdict, z.ZodTypeDef, unknown>,
      });
      // Providers sometimes echo the raw model name inside `model`; if they
      // don't, we still want callers to know a live judge produced this.
      if (!verdict.model) {
        return { ...verdict, model: this.provider.defaultModel };
      }
      return verdict;
    } catch {
      // Naive fallback so ingestion never fails purely because the judge
      // provider is unreachable. The neutral 0.5 score lets operators
      // configure whether "unknown" trips the review gate.
      return {
        score: 0.5,
        issues: [
          {
            targetType: 'resource',
            targetId: '*',
            reason: 'judge unavailable',
            severity: 'warn',
          },
        ],
        model: undefined,
      };
    }
  }
}
