import type { Logger } from '@carbon/core';
import type { Database } from '@carbon/database';
import type { Storage } from '@carbon/storage';
import type { IngestionPipeline } from '@carbon/ingestion';
import type { EmulatorRegistry } from './services/emulator-registry.js';

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
}
