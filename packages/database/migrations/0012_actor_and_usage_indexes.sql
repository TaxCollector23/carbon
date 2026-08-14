-- 0012_actor_and_usage_indexes.sql
-- Adds two hot-path indexes flagged by the R20 audit:
--   * events(org_id, actor_id)          — "actions by user X in org Y"
--   * usage_events(org_id, occurred_at) — time-window scans across all kinds
-- The existing (org_id, kind, occurred_at) usage index cannot serve queries
-- that omit `kind`, and events queries filtered by actor were previously
-- doing an index scan on org_id then a heap filter.

CREATE INDEX IF NOT EXISTS "events_org_actor_idx"
  ON "events" ("org_id", "actor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_org_occurred_idx"
  ON "usage_events" ("org_id", "occurred_at");
