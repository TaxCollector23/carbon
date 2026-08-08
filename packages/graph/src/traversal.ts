import type { BehaviorGraph, ResourceId } from '@carbon/types';

/**
 * How aggressively the runtime enforces referential integrity when it walks
 * relationship edges. `strict` (the default) removes rows whose foreign key
 * points at a missing parent — the graph pretends they don't exist so callers
 * never observe dangling references. `loose` keeps everything and lets the
 * caller reason about the drift themselves.
 */
export type ConsistencyMode = 'strict' | 'loose';

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

/**
 * Given a list of child rows and a lookup from parent id → parent row, drop
 * any child whose foreign key does not resolve — but only when the mode is
 * `strict`. In `loose` mode the caller gets every row back as-is, dangling
 * references included.
 */
export function enforceForeignKeys<Row extends Record<string, unknown>>(
  rows: readonly Row[],
  fkField: string,
  parentIds: ReadonlySet<string>,
  mode: ConsistencyMode,
): readonly Row[] {
  if (mode === 'loose') return rows;
  return rows.filter((row) => {
    const ref = row[fkField];
    return typeof ref === 'string' ? parentIds.has(ref) : false;
  });
}
