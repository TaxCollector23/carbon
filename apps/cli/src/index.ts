#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { initCommand } from './commands/init.js';
import { loginCommand } from './commands/login.js';
import { recordCommand } from './commands/record.js';
import { ingestCommand } from './commands/ingest.js';
import { emulateCommand } from './commands/emulate.js';
import { inspectCommand } from './commands/inspect.js';
import { snapshotCommand } from './commands/snapshot.js';
import { replayCommand } from './commands/replay.js';

const main = defineCommand({
  meta: {
    name: 'carbon',
    version: '0.1.0',
    description: 'Develop against production without production.',
  },
  subCommands: {
    init: initCommand,
    login: loginCommand,
    record: recordCommand,
    ingest: ingestCommand,
    emulate: emulateCommand,
    inspect: inspectCommand,
    snapshot: snapshotCommand,
    replay: replayCommand,
  },
});

runMain(main);
