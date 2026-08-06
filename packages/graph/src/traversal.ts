import type { BehaviorGraph, ResourceId } from '@carbon/types';

/** Returns the transitive closure of resources reachable from `root`. */
export function reachableFrom(graph: BehaviorGraph, root: ResourceId): Set<ResourceId> {
  const seen = new Set<ResourceId>([root]);
  const queue: ResourceId[] = [root];
  while (queue.length > 0) {
    const current = queue.shift() as ResourceId;
    for (const edge of graph.edges) {
      if (edge.from === current && !seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return seen;
}

/** Returns resources that should cascade when `root` is deleted. */
export function cascadeDeleteTargets(graph: BehaviorGraph, root: ResourceId): ResourceId[] {
  return graph.edges
    .filter((e) => e.kind === 'cascades-delete' && e.from === root)
    .map((e) => e.to);
}
