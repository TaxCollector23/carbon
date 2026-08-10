-- 0009_leads.sql
-- Marketing / Enterprise lead capture. Written by the public /v1/leads
-- endpoint (rate-limited per IP, no auth). Consumed by sales tooling — this
-- table is intentionally simple; enrichment (Clearbit, HubSpot sync, etc.)
-- happens downstream, not in the control plane.

CREATE TABLE IF NOT EXISTS "leads" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "company" text NOT NULL,
  "seats" integer,
  "use_case" text,
  "source" text,
  "ip" text,
  "user_agent" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_created_idx" ON "leads" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_email_idx" ON "leads" ("email");
