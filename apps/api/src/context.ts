import type { Logger } from '@carbon/core';
import type { Database } from '@carbon/database';
import type { Storage } from '@carbon/storage';
import type { IngestionPipeline } from '@carbon/ingestion';
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
  /** Optional — absent only in local/dev no-Redis mode. */
  readonly redis?: Redis;
  /**
   * Allow-list of interfaces an emulator may bind to. Defaults to
   * loopback-only; operators opt into wildcard binding by setting
   * `CARBON_EMULATOR_ALLOWED_HOSTS`.
   */
  readonly emulatorAllowedHosts?: readonly string[];
}
