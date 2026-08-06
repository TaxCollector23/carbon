import type { AuthScheme, HttpMethod, JsonType } from '../common.js';

/**
 * The Intermediate Representation (IR) is Carbon's canonical, format-agnostic
 * description of an API. Every parser — OpenAPI, GraphQL, HAR, Postman, live
 * traffic — normalizes into this shape. Every downstream stage (behavior graph,
 * runtime, sdk generation) reads only the IR.
 *
 * Design goals:
 *   1. Small. Not a superset of every input format — a common core.
 *   2. Stable. Adding a new parser must never change existing IR consumers.
 *   3. Losless enough for emulation. Anything the runtime needs must live here.
 *   4. Losseful for aesthetics. Presentation details (descriptions, tags) stay in `meta`.
 */
export interface IntermediateRepresentation {
  readonly version: 1;
  readonly api: ApiMeta;
  readonly servers: readonly Server[];
  readonly auth: readonly AuthScheme[];
  readonly resources: readonly ResourceDef[];
  readonly endpoints: readonly EndpointDef[];
  readonly relationships: readonly RelationshipDef[];
  readonly examples: readonly ExampleDef[];
  readonly meta: Readonly<Record<string, unknown>>;
}

export interface ApiMeta {
  readonly name: string;
  readonly version: string;
  readonly source: SourceProvenance;
}

export interface SourceProvenance {
  readonly kind: 'openapi' | 'swagger' | 'graphql' | 'postman' | 'har' | 'traffic' | 'docs' | 'mixed';
  /** Optional origin URL or file path — for debugging & diffing later ingests. */
  readonly origin?: string;
  /** Ingestion timestamp in ms since epoch. */
  readonly ingestedAt: number;
}

export interface Server {
  readonly url: string;
  readonly description?: string;
}

/**
 * A resource is a nameable entity in the API (Customer, Order, Repository).
 * The behavior graph attaches lifecycle & relationships to resources.
 */
export interface ResourceDef {
  readonly id: ResourceId;
  readonly name: string;
  /** Primary identifier field, e.g. `id` or `sk_id`. */
  readonly primaryKey: string;
  readonly schema: JsonType;
}
export type ResourceId = string & { readonly __brand: 'ResourceId' };

/**
 * An endpoint is a single (method, path) pair. Endpoints reference the resource
 * they operate on when the parser can determine it — otherwise `null`.
 */
export interface EndpointDef {
  readonly id: EndpointId;
  readonly method: HttpMethod;
  readonly path: string; // OpenAPI-style: /customers/{id}
  readonly operation: OperationKind;
  readonly resource: ResourceId | null;
  readonly params: readonly ParamDef[];
  readonly requestBody: JsonType | null;
  readonly responses: readonly ResponseDef[];
  readonly auth: readonly string[]; // references AuthScheme names, empty = public
  readonly meta: Readonly<Record<string, unknown>>;
}
export type EndpointId = string & { readonly __brand: 'EndpointId' };

/** Inferred CRUD-ish semantic. Best-effort. `custom` when nothing fits. */
export type OperationKind = 'list' | 'get' | 'create' | 'update' | 'replace' | 'delete' | 'action' | 'custom';

export interface ParamDef {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header' | 'cookie';
  readonly required: boolean;
  readonly schema: JsonType;
}

export interface ResponseDef {
  readonly status: number;
  readonly body: JsonType | null;
  readonly headers: Readonly<Record<string, JsonType>>;
}

export interface ExampleDef {
  readonly endpointId: EndpointId;
  readonly request: {
    readonly params: Readonly<Record<string, unknown>>;
    readonly body: unknown;
  };
  readonly response: {
    readonly status: number;
    readonly body: unknown;
  };
}

export interface RelationshipDef {
  readonly from: ResourceId;
  readonly to: ResourceId;
  readonly kind: 'owns' | 'belongs-to' | 'references' | 'many-to-many';
  /** Field on `from` that references `to`, or the join field for many-to-many. */
  readonly via: string;
}
