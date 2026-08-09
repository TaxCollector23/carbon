-- 0006_ai_quality_usage.sql
-- Persist AI judge verdicts so they become queryable, and add a usage_events
-- stream for the metered add-ons roadmap.

CREATE TABLE IF NOT EXISTS "ai_quality_reports" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "ir_key" text,
  "resources_score" text,
  "relationships_score" text,
  "min_score" text,
  "issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "needs_review" boolean NOT NULL DEFAULT false,
  "model" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_quality_reports" ADD CONSTRAINT "ai_quality_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_quality_reports_project_created_idx" ON "ai_quality_reports" ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_quality_reports_needs_review_idx" ON "ai_quality_reports" ("needs_review");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "kind" text NOT NULL,
  "amount" integer NOT NULL DEFAULT 1,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_org_kind_occurred_idx" ON "usage_events" ("org_id","kind","occurred_at");
