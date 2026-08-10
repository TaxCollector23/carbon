-- 0008_feature_flags.sql
-- Org/user/plan-scoped feature flags. `feature_flags` holds the flag
-- definition (default value + description); `feature_flag_overrides` holds
-- a value that supersedes the default for a specific scope. Resolution order
-- at read time: user override > org override > plan override > default.

CREATE TABLE IF NOT EXISTS "feature_flags" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "description" text,
  "default_value" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_key_unique" ON "feature_flags" ("key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "feature_flag_overrides" (
  "id" text PRIMARY KEY NOT NULL,
  "flag_key" text NOT NULL,
  "scope" text NOT NULL,
  "scope_id" text NOT NULL,
  "value" boolean NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flag_overrides_scope_unique"
  ON "feature_flag_overrides" ("flag_key","scope","scope_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_flag_overrides_lookup_idx"
  ON "feature_flag_overrides" ("scope","scope_id","flag_key");
