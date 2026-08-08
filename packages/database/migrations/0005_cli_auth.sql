-- 0005_cli_auth.sql
-- Device-authorization CLI login sessions (like `gh auth login`).

CREATE TABLE IF NOT EXISTS "cli_auth_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "verifier" text NOT NULL,
  "org_id" text,
  "user_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "approved_api_key_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "approved_at" timestamp with time zone,
  "revealed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cli_auth_sessions" ADD CONSTRAINT "cli_auth_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cli_auth_sessions" ADD CONSTRAINT "cli_auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cli_auth_sessions" ADD CONSTRAINT "cli_auth_sessions_approved_api_key_id_api_keys_id_fk" FOREIGN KEY ("approved_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cli_auth_sessions_verifier_unique" ON "cli_auth_sessions" ("verifier");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cli_auth_sessions_expiry_idx" ON "cli_auth_sessions" ("expires_at");
