-- 0007_fulltext_search.sql
-- Postgres full-text search across events, projects, and artifacts. Each
-- table gets a generated `search_tsv` tsvector column plus a GIN index so
-- the `/v1/search` endpoint can grep org history without table scans.
--
-- The `simple` dictionary is used deliberately: search terms in Carbon's
-- audit stream are dominated by identifiers (slugs, action verbs like
-- `project.created`, JSON keys) — English stemming would swallow useful
-- prefixes.

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce("action", '') || ' ' || coalesce("actor_id", '') || ' ' || coalesce("metadata"::text, '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_search_tsv_idx" ON "events" USING GIN ("search_tsv");
--> statement-breakpoint

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce("slug", '') || ' ' || coalesce("name", ''))
  ) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_search_tsv_idx" ON "projects" USING GIN ("search_tsv");
--> statement-breakpoint

ALTER TABLE "artifacts"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce("storage_key", '') || ' ' || coalesce("meta"::text, '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifacts_search_tsv_idx" ON "artifacts" USING GIN ("search_tsv");
