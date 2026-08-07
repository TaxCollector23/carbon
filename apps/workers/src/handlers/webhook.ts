import { createHmac } from 'node:crypto';
import type { Logger } from '@carbon/core';
import { CarbonError } from '@carbon/core';
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
    const signature = createHmac('sha256', payload.secret).update(`${timestamp}.${body}`).digest('hex');
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
