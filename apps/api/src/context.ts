import type { Logger } from '@carbon/core';
import type { Database } from '@carbon/database';
import type { Storage } from '@carbon/storage';
import type { IngestionPipeline } from '@carbon/ingestion';
import type { Queue } from 'bullmq';
import type { IngestJobPayload } from '@carbon/workers';
import type { Redis } from 'ioredis';
import type { EmulatorRegistry } from './services/emulator-registry.js';
import type { JobService } from './services/jobs.js';

/**
 * Application context — the DI container passed to every route module.
 * Nothing in `apps/api` reaches for a global; every dependency arrives here.
 */
export interface AppContext {
  readonly logger: Logger;
  readonly db: Database;
  readonly storage: Storage;
  readonly ingestion: IngestionPipeline;
  readonly emulators: EmulatorRegistry;
  /** Optional — absent when Redis is not configured. */
  readonly jobs?: JobService;
  /**
   * Optional — absent when Redis is not configured. Producer side of the
   * ingestion queue; the worker side lives in `apps/workers` (or in-process
   * when `EMBED_WORKERS=true`).
   */
  readonly ingestionQueue?: Queue<IngestJobPayload>;
  /** Optional — absent only in local/dev no-Redis mode. */
  readonly redis?: Redis;
  /**
   * Allow-list of interfaces an emulator may bind to. Defaults to
   * loopback-only; operators opt into wildcard binding by setting
   * `CARBON_EMULATOR_ALLOWED_HOSTS`.
   */
  readonly emulatorAllowedHosts?: readonly string[];
  /**
   * Minimum acceptable judge score. Used by the ingest route when persisting
   * AI-quality reports to Postgres — anything below this trips `needsReview`.
   * Defaults to 0.75 when unset (matches `AiJudge`'s own default).
   */
  readonly judgeThreshold?: number;
}
