ALTER TABLE "api_keys" ADD COLUMN "scopes" text[] DEFAULT ARRAY['admin']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "project_ids" text[];