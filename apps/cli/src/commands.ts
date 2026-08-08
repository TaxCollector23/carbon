import type { CommandDef } from 'citty';
import { doctorCommand } from './commands/doctor.js';
import { emulateCommand } from './commands/emulate.js';
import { generateTestsCommand } from './commands/generate-tests.js';
import { ingestCommand } from './commands/ingest.js';
import { initCommand } from './commands/init.js';
import { inspectCommand } from './commands/inspect.js';
import { loginCommand } from './commands/login.js';
import { recordCommand } from './commands/record.js';
import { replayCommand } from './commands/replay.js';
import { snapshotCommand } from './commands/snapshot.js';

export interface CliCommandInfo {
  readonly command: string;
  readonly description: string;
}

type AnyCommand = CommandDef<any>;

export const cliSubCommands = {
  init: initCommand,
  login: loginCommand,
  record: recordCommand,
  ingest: ingestCommand,
  emulate: emulateCommand,
  inspect: inspectCommand,
  snapshot: snapshotCommand,
  replay: replayCommand,
  doctor: doctorCommand,
  'generate-tests': generateTestsCommand,
} satisfies Record<string, AnyCommand>;

export const cliCommandCatalog: readonly CliCommandInfo[] = [
  commandInfo('init', initCommand),
  commandInfo('login', loginCommand),
  commandInfo('record', recordCommand),
  commandInfo('ingest', ingestCommand),
  commandInfo('emulate', emulateCommand),
  commandInfo('inspect', inspectCommand),
  commandInfo('snapshot', snapshotCommand),
  commandInfo('snapshot save', snapshotSubCommand('save')),
  commandInfo('snapshot load', snapshotSubCommand('load')),
  commandInfo('snapshot list', snapshotSubCommand('list')),
  commandInfo('snapshot delete', snapshotSubCommand('delete')),
  commandInfo('replay', replayCommand),
  commandInfo('doctor', doctorCommand),
  commandInfo('generate-tests', generateTestsCommand),
];

function commandInfo(command: string, def: AnyCommand): CliCommandInfo {
  return {
    command: `carbon ${command}`,
    description: commandDescription(def),
  };
}

function snapshotSubCommand(name: 'save' | 'load' | 'list' | 'delete'): AnyCommand {
  const subCommands = snapshotCommand.subCommands;
  if (!subCommands || typeof subCommands === 'function' || subCommands instanceof Promise) {
    return {};
  }
  return subCommands[name] as AnyCommand;
}

function commandDescription(def: AnyCommand): string {
  const meta = def.meta;
  if (!meta || typeof meta === 'function' || meta instanceof Promise) return '';
  return meta.description ?? '';
}
