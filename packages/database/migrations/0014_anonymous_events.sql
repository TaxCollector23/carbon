-- 0014_anonymous_events.sql
-- Anonymous marketing-funnel events for the public marketing site. Separate
-- from the org-scoped `events` audit table: there is no org on the landing
-- page, and the orgId column on `events` is NOT NULL. Only a one-way hash of
-- the client IP is stored (unique-visitor bucketing without PII).

CREATE TABLE IF NOT EXISTS "anonymous_events" (
  "id" text PRIMARY KEY NOT NULL,
  "action" text NOT NULL,
  "ip_hash" text,
  "path" text,
  "user_agent" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "anonymous_events_action_created_idx" ON "anonymous_events" ("action", "created_at");
CREATE INDEX IF NOT EXISTS "anonymous_events_created_idx" ON "anonymous_events" ("created_at");
