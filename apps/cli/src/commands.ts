import type { CommandDef } from 'citty';
import { capabilitiesCommand } from './commands/capabilities.js';
import { ciCommand } from './commands/ci.js';
import { activityCommand } from './commands/activity.js';
import { auditSecretsCommand } from './commands/audit-secrets.js';
import { completionCommand } from './commands/completion.js';
import { diffCommand } from './commands/diff.js';
import { doctorCommand } from './commands/doctor.js';
import { emulateCommand } from './commands/emulate.js';
import { exportCommand } from './commands/export.js';
import { explainCommand } from './commands/explain.js';
import { generateTestsCommand } from './commands/generate-tests.js';
import { ingestCommand } from './commands/ingest.js';
import { initCommand } from './commands/init.js';
import { inspectCommand } from './commands/inspect.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { qualityCommand } from './commands/quality.js';
import { recordCommand } from './commands/record.js';
import { replayCommand } from './commands/replay.js';
import { serveCommand } from './commands/serve.js';
import { snapshotCommand } from './commands/snapshot.js';
import { testCommand } from './commands/test.js';
import { tryCommand } from './commands/try.js';
import { usageCommand } from './commands/usage.js';
import { watchCommand } from './commands/watch.js';
import { whoamiCommand } from './commands/whoami.js';

export interface CliCommandInfo {
  readonly command: string;
  readonly description: string;
}

type AnyCommand = CommandDef<any>;

export const cliSubCommands = {
  capabilities: capabilitiesCommand,
  ci: ciCommand,
  init: initCommand,
  login: loginCommand,
  logout: logoutCommand,
  whoami: whoamiCommand,
  record: recordCommand,
  ingest: ingestCommand,
  emulate: emulateCommand,
  inspect: inspectCommand,
  snapshot: snapshotCommand,
  test: testCommand,
  try: tryCommand,
  replay: replayCommand,
  serve: serveCommand,
  doctor: doctorCommand,
  diff: diffCommand,
  'generate-tests': generateTestsCommand,
  usage: usageCommand,
  watch: watchCommand,
  activity: activityCommand,
  quality: qualityCommand,
  export: exportCommand,
  explain: explainCommand,
  completion: completionCommand,
  'audit-secrets': auditSecretsCommand,
} satisfies Record<string, AnyCommand>;

export const cliCommandCatalog: readonly CliCommandInfo[] = [
  commandInfo('capabilities', capabilitiesCommand),
  commandInfo('ci', ciCommand),
  commandInfo('init', initCommand),
  commandInfo('login', loginCommand),
  commandInfo('logout', logoutCommand),
  commandInfo('whoami', whoamiCommand),
  commandInfo('record', recordCommand),
  commandInfo('ingest', ingestCommand),
  commandInfo('emulate', emulateCommand),
  commandInfo('inspect', inspectCommand),
  commandInfo('snapshot', snapshotCommand),
  commandInfo('test', testCommand),
  commandInfo('try', tryCommand),
  commandInfo('snapshot save', snapshotSubCommand('save')),
  commandInfo('snapshot load', snapshotSubCommand('load')),
  commandInfo('snapshot list', snapshotSubCommand('list')),
  commandInfo('snapshot delete', snapshotSubCommand('delete')),
  commandInfo('snapshot push', snapshotSubCommand('push')),
  commandInfo('snapshot pull', snapshotSubCommand('pull')),
  commandInfo('replay', replayCommand),
  commandInfo('serve', serveCommand),
  commandInfo('doctor', doctorCommand),
  commandInfo('diff', diffCommand),
  commandInfo('generate-tests', generateTestsCommand),
  commandInfo('usage', usageCommand),
  commandInfo('watch', watchCommand),
  commandInfo('activity', activityCommand),
  commandInfo('quality', qualityCommand),
  commandInfo('export', exportCommand),
  commandInfo('explain', explainCommand),
  commandInfo('completion', completionCommand),
  commandInfo('audit-secrets', auditSecretsCommand),
];

function commandInfo(command: string, def: AnyCommand): CliCommandInfo {
  return {
    command: `carbon ${command}`,
    description: commandDescription(def),
  };
}

function snapshotSubCommand(
  name: 'save' | 'load' | 'list' | 'delete' | 'push' | 'pull',
): AnyCommand {
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
