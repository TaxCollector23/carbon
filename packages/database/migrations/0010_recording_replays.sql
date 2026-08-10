-- 0010_recording_replays.sql
-- Records outcomes of dashboard-initiated recording replays. One row per
-- replay run against a target URL; `results` is a JSON list of
-- {exchangeId, status, diff, latencyMs} entries. Kept append-only so the
-- dashboard can show a run history per recording.

CREATE TABLE IF NOT EXISTS "recording_replays" (
  "id" text PRIMARY KEY NOT NULL,
  "recording_id" text NOT NULL,
  "project_id" text REFERENCES "projects"("id") ON DELETE CASCADE,
  "target_url" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ok',
  "results" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recording_replays_recording_idx"
  ON "recording_replays" ("recording_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recording_replays_project_idx"
  ON "recording_replays" ("project_id", "created_at");
