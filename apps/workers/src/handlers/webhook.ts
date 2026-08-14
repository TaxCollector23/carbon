import { createHmac } from 'node:crypto';
import { and, desc, gt, inArray } from 'drizzle-orm';
import type { Logger } from '@carbon/core';
import { CarbonError } from '@carbon/core';
import { schema, type Database } from '@carbon/database';
import type { WebhookDeliveryPayload } from '@carbon/workers';

/**
 * Deliver a webhook to the configured URL. Signs the payload with HMAC-SHA256
 * if a secret is provided (Stripe-style: `t=<unix>,v1=<sig>`), retries up to
 * `maxAttempts` times with exponential backoff on 5xx / network errors, and
 * throws on final failure so BullMQ can move the job to failed for review.
 */
export interface DeliverOpts {
  readonly logger: Logger;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
}

export async function deliverWebhook(
  payload: WebhookDeliveryPayload,
  opts: DeliverOpts,
): Promise<{ status: number }> {
  const logger = opts.logger.child({ event: payload.event, url: payload.url });
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxAttempts = opts.maxAttempts ?? 5;
  const body = JSON.stringify(payload.body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'Carbon-Webhooks/1.0',
    'x-carbon-event': payload.event,
    'x-carbon-attempt': String(payload.attempt ?? 1),
  };
  if (payload.secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', payload.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    headers['x-carbon-signature'] = `t=${timestamp},v1=${signature}`;
  }

  let attempt = 1;
  let lastError: string | null = null;
  while (attempt <= maxAttempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(payload.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status < 500 && res.status !== 429) {
        logger.info('webhook.delivered', { status: res.status, attempt });
        return { status: res.status };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      clearTimeout(timer);
      lastError = (err as Error).message;
    }
    const backoff = Math.min(30_000, 500 * 2 ** (attempt - 1));
    logger.warn('webhook.retry', { attempt, backoff, lastError });
    await new Promise((r) => setTimeout(r, backoff));
    attempt++;
  }
  throw new CarbonError({
    code: 'CARBON_INTERNAL',
    message: `Webhook delivery failed after ${maxAttempts} attempts: ${lastError}`,
  });
}

/**
 * Chat notifier — polls the events table and forwards a small set of
 * high-signal actions to per-org Slack/Discord webhooks configured under
 * `organizations.settings.slackWebhookUrl` / `discordWebhookUrl`.
 *
 * Kept as a poller rather than a Postgres LISTEN/NOTIFY subscriber so the
 * workers process doesn't require an extra dedicated pg connection — the
 * events table is small and indexed on (org, created_at), and we only look
 * at ~1s of tail per tick per org.
 */
export const NOTIFY_ACTIONS = new Set([
  'snapshot.overwritten',
  'emulator.crashed',
  'drift.detected',
]);

export interface EventNotifierOptions {
  readonly db: Database;
  readonly logger: Logger;
  /** Poll cadence, default 15s. */
  readonly intervalMs?: number;
  readonly skipInitialRun?: boolean;
}

export interface EventNotifier {
  readonly stop: () => void;
  readonly runOnce: () => Promise<{ delivered: number }>;
}

interface OrgSettings {
  slackWebhookUrl?: string;
  discordWebhookUrl?: string;
}

const DEFAULT_NOTIFIER_INTERVAL_MS = 15_000;

export function startEventNotifier(opts: EventNotifierOptions): EventNotifier {
  const intervalMs = opts.intervalMs ?? DEFAULT_NOTIFIER_INTERVAL_MS;
  let lastCheckedAt = new Date();
  let stopped = false;

  const runOnce = async (): Promise<{ delivered: number }> => {
    const now = new Date();
    const rows = await opts.db
      .select({
        id: schema.events.id,
        orgId: schema.events.orgId,
        projectId: schema.events.projectId,
        action: schema.events.action,
        metadata: schema.events.metadata,
        createdAt: schema.events.createdAt,
      })
      .from(schema.events)
      .where(
        and(
          gt(schema.events.createdAt, lastCheckedAt),
          inArray(schema.events.action, [...NOTIFY_ACTIONS]),
        ),
      )
      .orderBy(desc(schema.events.createdAt))
      .limit(500);

    lastCheckedAt = now;
    if (rows.length === 0) return { delivered: 0 };

    const orgIds = [...new Set(rows.map((r) => r.orgId))];
    const orgs = await opts.db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        settings: schema.organizations.settings,
      })
      .from(schema.organizations)
      .where(inArray(schema.organizations.id, orgIds));
    const settingsByOrg = new Map<string, { name: string; settings: OrgSettings }>();
    for (const org of orgs) {
      settingsByOrg.set(org.id, {
        name: org.name,
        settings: (org.settings ?? {}) as OrgSettings,
      });
    }

    let delivered = 0;
    for (const row of rows) {
      const cfg = settingsByOrg.get(row.orgId);
      if (!cfg) continue;
      const message = formatEventMessage(cfg.name, row);
      if (cfg.settings.slackWebhookUrl) {
        if (await postJson(cfg.settings.slackWebhookUrl, { text: message }, opts.logger)) {
          delivered++;
        }
      }
      if (cfg.settings.discordWebhookUrl) {
        if (await postJson(cfg.settings.discordWebhookUrl, { content: message }, opts.logger)) {
          delivered++;
        }
      }
    }
    return { delivered };
  };

  if (!opts.skipInitialRun) {
    void runOnce().catch((err: unknown) => {
      opts.logger.warn('notifier.run_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  const timer = setInterval(() => {
    if (stopped) return;
    void runOnce().catch((err: unknown) => {
      opts.logger.warn('notifier.run_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    runOnce,
  };
}

function formatEventMessage(
  orgName: string,
  row: { action: string; projectId: string | null; metadata: unknown; createdAt: Date },
): string {
  const scope = row.projectId ? ` project=${row.projectId}` : '';
  return `[Carbon/${orgName}] ${row.action}${scope} at ${row.createdAt.toISOString()}`;
}

async function postJson(url: string, body: unknown, logger: Logger): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn('notifier.post_failed', { url, status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('notifier.post_error', {
      url,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
