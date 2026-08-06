import type {
  BehaviorEdge,
  BehaviorGraph,
  ConstraintRule,
  EndpointDef,
  EndpointId,
  IntermediateRepresentation,
  RelationshipDef,
  ResourceDef,
  ResourceId,
  ResourceNode,
  TransitionRule,
} from '@carbon/types';

/**
 * Deterministically compiles an IR into a BehaviorGraph. This is the deepest
 * point where "understanding" of the API happens without invoking AI — every
 * transformation here is a mechanical, reproducible mapping.
 *
 * AI-derived enrichments (inferred relationships, lifecycle machines) are
 * merged in later by the ingestion orchestrator. The builder itself must
 * always produce the same graph for the same IR.
 */
export class BehaviorGraphBuilder {
  build(ir: IntermediateRepresentation): BehaviorGraph {
    const endpointsByResource = groupEndpointsByResource(ir.endpoints);
    const nodes: ResourceNode[] = ir.resources.map((resource) =>
      this.buildNode(resource, endpointsByResource.get(resource.id) ?? []),
    );

    const edges: BehaviorEdge[] = ir.relationships.map(toEdge);
    const transitions: TransitionRule[] = ir.endpoints.flatMap((e) => this.transitionsFor(e));
    const constraints: ConstraintRule[] = buildConstraints(ir.resources, ir.relationships);

    return { version: 1, nodes, edges, transitions, constraints };
  }

  private buildNode(resource: ResourceDef, endpoints: EndpointDef[]): ResourceNode {
    const readers: EndpointId[] = [];
    const writers: EndpointId[] = [];
    for (const e of endpoints) {
      if (e.operation === 'get' || e.operation === 'list') readers.push(e.id);
      else writers.push(e.id);
    }
    return {
      id: resource.id,
      name: resource.name,
      readers,
      writers,
      lifecycle: null,
    };
  }

  private transitionsFor(endpoint: EndpointDef): TransitionRule[] {
    if (!endpoint.resource) return [];
    switch (endpoint.operation) {
      case 'create':
        return [
          {
            id: `${endpoint.id}::create`,
            endpoint: endpoint.id,
            effects: [{ kind: 'create', resource: endpoint.resource, fromBody: true }],
            guards: endpoint.auth.map((scheme) => ({ kind: 'auth', scheme })),
          },
        ];
      case 'update':
      case 'replace':
        return [
          {
            id: `${endpoint.id}::update`,
            endpoint: endpoint.id,
            effects: [
              {
                kind: 'update',
                resource: endpoint.resource,
                selector: primaryKeySelector(endpoint),
              },
            ],
            guards: endpoint.auth.map((scheme) => ({ kind: 'auth', scheme })),
          },
        ];
      case 'delete':
        return [
          {
            id: `${endpoint.id}::delete`,
            endpoint: endpoint.id,
            effects: [
              {
                kind: 'delete',
                resource: endpoint.resource,
                selector: primaryKeySelector(endpoint),
              },
            ],
            guards: endpoint.auth.map((scheme) => ({ kind: 'auth', scheme })),
          },
        ];
      default:
        return [];
    }
  }
}

function groupEndpointsByResource(endpoints: readonly EndpointDef[]): Map<ResourceId, EndpointDef[]> {
  const out = new Map<ResourceId, EndpointDef[]>();
  for (const e of endpoints) {
    if (!e.resource) continue;
    const list = out.get(e.resource) ?? [];
    list.push(e);
    out.set(e.resource, list);
  }
  return out;
}

function toEdge(rel: RelationshipDef): BehaviorEdge {
  return { kind: rel.kind, from: rel.from, to: rel.to, via: rel.via } as BehaviorEdge;
}

function primaryKeySelector(endpoint: EndpointDef) {
  const pathParam = endpoint.params.find((p) => p.in === 'path');
  return {
    source: 'path' as const,
    field: pathParam?.name ?? 'id',
    matches: 'id',
  };
}

function buildConstraints(
  resources: readonly ResourceDef[],
  relationships: readonly RelationshipDef[],
): ConstraintRule[] {
  const constraints: ConstraintRule[] = resources.map((r) => ({
    kind: 'unique',
    resource: r.id,
    fields: [r.primaryKey],
  }));
  for (const rel of relationships) {
    if (rel.kind === 'belongs-to' || rel.kind === 'references') {
      constraints.push({ kind: 'foreign-key', from: rel.from, field: rel.via, to: rel.to });
    }
  }
  return constraints;
}
