import { createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { Logger } from '@carbon/core';
import { schema, type Database } from '@carbon/database';

/**
 * Slack access-token decryption. Deliberately duplicated (rather than imported
 * from apps/api) because the workers package does not — and should not —
 * depend on apps/api. The wire format matches apps/api/src/services/slack.ts:
 *   base64( 1-byte version | 12-byte IV | 16-byte tag | ciphertext )
 * If you change either side, change the other in the same commit.
 */
const VERSION_BYTE = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;
let warned = false;
function slackKey(logger: Logger): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.SLACK_TOKEN_ENC_KEY;
  if (raw && raw.length > 0) {
    cachedKey = createHash('sha256').update(raw, 'utf8').digest();
    return cachedKey;
  }
  if (!warned) {
    logger.warn('slack.ephemeral_key', {
      message:
        'SLACK_TOKEN_ENC_KEY unset — using an ephemeral per-process key. Any tokens ' +
        'encrypted by the API with a different key will be undecryptable here.',
    });
    warned = true;
  }
  cachedKey = randomBytes(32);
  return cachedKey;
}

function decryptSlackToken(ciphertext: string, logger: Logger): string {
  const raw = Buffer.from(ciphertext, 'base64');
  if (raw.length < 1 + IV_LEN + TAG_LEN) throw new Error('token ciphertext too short');
  if (raw[0] !== VERSION_BYTE) throw new Error(`bad token version ${raw[0]}`);
  const iv = raw.subarray(1, 1 + IV_LEN);
  const tag = raw.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const enc = raw.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', slackKey(logger), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/**
 * Slack notifier — the real-Slack-app counterpart to the legacy webhook-URL
 * `startEventNotifier` in ./handlers/webhook.ts.
 *
 * For every event in the events table that matches at least one
 * `slack_channel_subscriptions.events` entry, POST a Block Kit message to
 * every subscribed channel via `chat.postMessage`, using the bot token stored
 * (encrypted) on the parent `slack_installations` row.
 *
 * Implemented as a poller (like startEventNotifier) rather than an in-process
 * eventBus subscriber, because the workers process runs separately from the
 * API. When a Redis subscription is desired (round 10 A1 SSE fan-out) an
 * operator can front this with the pub/sub channel; the poller keeps the
 * one-instance dev flow working with no Redis.
 */

export interface SlackNotifierOptions {
  readonly db: Database;
  readonly logger: Logger;
  /** Poll cadence, default 10s. */
  readonly intervalMs?: number;
  readonly skipInitialRun?: boolean;
  /** Injectable HTTP client — tests supply a stub. */
  readonly postMessage?: (input: {
    token: string;
    channel: string;
    text: string;
    blocks: unknown[];
  }) => Promise<{ ok: boolean; error?: string }>;
}

export interface SlackNotifier {
  readonly stop: () => void;
  readonly runOnce: () => Promise<{ delivered: number }>;
}

const DEFAULT_INTERVAL_MS = 10_000;

async function defaultPostMessage(input: {
  token: string;
  channel: string;
  text: string;
  blocks: unknown[];
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel: input.channel, text: input.text, blocks: input.blocks }),
  });
  return (await res.json()) as { ok: boolean; error?: string };
}

export function startSlackNotifier(opts: SlackNotifierOptions): SlackNotifier {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const post = opts.postMessage ?? defaultPostMessage;
  let lastCheckedAt = new Date();
  let stopped = false;

  const runOnce = async (): Promise<{ delivered: number }> => {
    // Pull all subscriptions once per tick — the set is small (one row per
    // (org, channel, event-selection) tuple). We filter events in memory
    // against the union of subscribed actions.
    const subs = await opts.db
      .select({
        subId: schema.slackChannelSubscriptions.id,
        installationId: schema.slackChannelSubscriptions.installationId,
        channelId: schema.slackChannelSubscriptions.channelId,
        channelName: schema.slackChannelSubscriptions.channelName,
        events: schema.slackChannelSubscriptions.events,
        orgId: schema.slackInstallations.orgId,
        teamName: schema.slackInstallations.teamName,
        accessToken: schema.slackInstallations.accessToken,
      })
      .from(schema.slackChannelSubscriptions)
      .innerJoin(
        schema.slackInstallations,
        eq(schema.slackInstallations.id, schema.slackChannelSubscriptions.installationId),
      );

    if (subs.length === 0) {
      lastCheckedAt = new Date();
      return { delivered: 0 };
    }

    // Union of every action any subscription cares about, and per-org grouping.
    const subscribedActions = new Set<string>();
    const subsByOrg = new Map<string, typeof subs>();
    for (const s of subs) {
      for (const a of s.events) subscribedActions.add(a);
      const list = subsByOrg.get(s.orgId) ?? [];
      list.push(s);
      subsByOrg.set(s.orgId, list);
    }

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
          inArray(schema.events.action, [...subscribedActions]),
        ),
      )
      .orderBy(desc(schema.events.createdAt))
      .limit(500);
    lastCheckedAt = now;
    if (rows.length === 0) return { delivered: 0 };

    let delivered = 0;
    for (const evt of rows) {
      const orgSubs = subsByOrg.get(evt.orgId);
      if (!orgSubs) continue;
      for (const sub of orgSubs) {
        if (!sub.events.includes(evt.action)) continue;
        let token: string;
        try {
          token = decryptSlackToken(sub.accessToken, opts.logger);
        } catch (err) {
          opts.logger.warn('slack.decrypt_failed', {
            installationId: sub.installationId,
            message: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        const blocks = buildBlocks(sub.teamName, evt);
        try {
          const res = await post({
            token,
            channel: sub.channelId,
            text: `[Carbon/${sub.teamName}] ${evt.action}`,
            blocks,
          });
          if (res.ok) {
            delivered++;
          } else {
            opts.logger.warn('slack.post_failed', {
              subId: sub.subId,
              channel: sub.channelId,
              error: res.error,
            });
          }
        } catch (err) {
          opts.logger.warn('slack.post_error', {
            subId: sub.subId,
            channel: sub.channelId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return { delivered };
  };

  if (!opts.skipInitialRun) {
    void runOnce().catch((err: unknown) => {
      opts.logger.warn('slack_notifier.run_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  const timer = setInterval(() => {
    if (stopped) return;
    void runOnce().catch((err: unknown) => {
      opts.logger.warn('slack_notifier.run_failed', {
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

function buildBlocks(
  teamName: string,
  evt: { action: string; projectId: string | null; metadata: unknown; createdAt: Date },
): unknown[] {
  const meta = (evt.metadata ?? {}) as Record<string, unknown>;
  const summary = `*${evt.action}*` + (evt.projectId ? ` · project \`${evt.projectId}\`` : '');
  const fields: Array<{ type: 'mrkdwn'; text: string }> = [];
  fields.push({ type: 'mrkdwn', text: `*Workspace*\n${teamName}` });
  fields.push({
    type: 'mrkdwn',
    text: `*When*\n${evt.createdAt.toISOString()}`,
  });
  const metaKeys = Object.keys(meta).slice(0, 6);
  for (const k of metaKeys) {
    const v = meta[k];
    const shown = typeof v === 'string' ? v : JSON.stringify(v);
    fields.push({
      type: 'mrkdwn',
      text: `*${k}*\n${String(shown).slice(0, 200)}`,
    });
  }
  return [
    { type: 'section', text: { type: 'mrkdwn', text: summary } },
    { type: 'section', fields },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'via Carbon' }] },
  ];
}
