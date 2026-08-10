-- 0011_slack_integrations.sql
-- Real Slack app installation + per-channel event subscription. Backs the
-- Round-13 A4 slack.ts route + apps/workers slack-notifier. The access
-- token is stored encrypted (AES-256-GCM); see apps/api/src/services/slack.ts.

CREATE TABLE IF NOT EXISTS "slack_installations" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "team_id" text NOT NULL,
  "team_name" text NOT NULL,
  "access_token" text NOT NULL,
  "bot_user_id" text,
  "app_id" text,
  "installed_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "installed_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "slack_installations_org_team_unique"
  ON "slack_installations" ("org_id", "team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_installations_org_idx"
  ON "slack_installations" ("org_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "slack_channel_subscriptions" (
  "id" text PRIMARY KEY NOT NULL,
  "installation_id" text NOT NULL REFERENCES "slack_installations"("id") ON DELETE CASCADE,
  "channel_id" text NOT NULL,
  "channel_name" text NOT NULL,
  "events" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "slack_channel_subscriptions_install_channel_unique"
  ON "slack_channel_subscriptions" ("installation_id", "channel_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_channel_subscriptions_install_idx"
  ON "slack_channel_subscriptions" ("installation_id");
