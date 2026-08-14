import type { EndpointId, ResourceId } from '../ir/index.js';

/**
 * The Behavior Graph is Carbon's most valuable derived asset. It transforms
 * the IR — a static description of what an API exposes — into a description
 * of how the API behaves.
 *
 * Nodes are resources. Edges express relationships, transitions, and effects.
 * The State Engine consumes this graph to produce a deterministic runtime.
 */
export interface BehaviorGraph {
  readonly version: 1;
  readonly nodes: readonly ResourceNode[];
  readonly edges: readonly BehaviorEdge[];
  readonly transitions: readonly TransitionRule[];
  readonly constraints: readonly ConstraintRule[];
}

export interface ResourceNode {
  readonly id: ResourceId;
  readonly name: string;
  /** Endpoints that read this resource. */
  readonly readers: readonly EndpointId[];
  /** Endpoints that mutate this resource. */
  readonly writers: readonly EndpointId[];
  /** Optional lifecycle state machine (e.g. subscription: active → past_due → canceled). */
  readonly lifecycle: LifecycleMachine | null;
}

export interface LifecycleMachine {
  readonly field: string;
  readonly states: readonly string[];
  readonly initial: string;
  readonly transitions: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly via: EndpointId;
  }>;
}

export type BehaviorEdge =
  | {
      readonly kind: 'owns';
      readonly from: ResourceId;
      readonly to: ResourceId;
      readonly via: string;
    }
  | {
      readonly kind: 'belongs-to';
      readonly from: ResourceId;
      readonly to: ResourceId;
      readonly via: string;
    }
  | {
      readonly kind: 'references';
      readonly from: ResourceId;
      readonly to: ResourceId;
      readonly via: string;
    }
  | { readonly kind: 'cascades-delete'; readonly from: ResourceId; readonly to: ResourceId };

/**
 * A transition rule says: when this endpoint is invoked with a matching state,
 * these mutations occur. The State Engine executes these deterministically.
 */
export interface TransitionRule {
  readonly id: string;
  readonly endpoint: EndpointId;
  readonly effects: readonly Effect[];
  readonly guards: readonly Guard[];
}

export type Effect =
  | { readonly kind: 'create'; readonly resource: ResourceId; readonly fromBody: true }
  | { readonly kind: 'update'; readonly resource: ResourceId; readonly selector: Selector }
  | { readonly kind: 'delete'; readonly resource: ResourceId; readonly selector: Selector }
  | { readonly kind: 'emit-webhook'; readonly event: string };

export type Guard =
  | { readonly kind: 'exists'; readonly resource: ResourceId; readonly selector: Selector }
  | { readonly kind: 'auth'; readonly scheme: string };

export interface Selector {
  /** Where the identifier comes from — a path param, query, header, or body field. */
  readonly source: 'path' | 'query' | 'header' | 'body';
  readonly field: string;
  /** Which resource field is being matched (usually the primary key). */
  readonly matches: string;
}

export type ConstraintRule =
  | { readonly kind: 'unique'; readonly resource: ResourceId; readonly fields: readonly string[] }
  | { readonly kind: 'required'; readonly resource: ResourceId; readonly fields: readonly string[] }
  | {
      readonly kind: 'foreign-key';
      readonly from: ResourceId;
      readonly field: string;
      readonly to: ResourceId;
    };
