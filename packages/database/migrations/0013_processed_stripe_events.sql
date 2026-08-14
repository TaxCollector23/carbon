-- 0013_processed_stripe_events.sql
-- Idempotency ledger for Stripe webhook events. The webhook handler INSERTs
-- the event id here first; on unique_violation it returns 200 immediately so
-- Stripe stops retrying. `id` is Stripe's globally-unique evt_* — no org
-- scoping needed.

CREATE TABLE IF NOT EXISTS "processed_stripe_events" (
  "id" text PRIMARY KEY,
  "type" text,
  "received_at" timestamptz NOT NULL DEFAULT now()
);
