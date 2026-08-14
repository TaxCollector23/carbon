#!/usr/bin/env node
import { defineCommand, renderUsage, runMain, type ArgsDef, type CommandDef } from 'citty';
import { cliCommandCatalog, cliSubCommands } from './commands.js';
import { ui } from './ui.js';
import { setPrinterMode, isJson } from './lib/printer.js';
import { maybeShowNotice, track } from './lib/telemetry.js';
import { scheduleUpdateCheck } from './lib/update-check.js';
import { EXIT_ASSERTION_FAILED, EXIT_CONNECTIVITY, EXIT_INTERNAL } from './lib/exit-codes.js';

export const CARBON_VERSION = '0.2.1';
// Expose to telemetry without a circular import.
if (!process.env.CARBON_VERSION) process.env.CARBON_VERSION = CARBON_VERSION;

// Note: no `run()` on the parent — citty invokes the parent's run() AFTER a
// matched subcommand, so a top-level welcome here prints on every `carbon X`
// invocation. The no-args welcome is handled by `runCli` directly.
export const main = defineCommand({
  meta: {
    name: 'carbon',
    version: CARBON_VERSION,
    description: 'Build and run stateful API replicas for development, tests, and CI.',
  },
  subCommands: cliSubCommands,
});

async function printWelcome(): Promise<void> {
  ui.welcome(CARBON_VERSION);
  ui.header('Commands');
  ui.commandList(cliCommandCatalog);
  process.stdout.write(
    '\n  Run `carbon login` for account-backed dashboard workflows.\n' +
      '  Run `carbon emulate --from <spec.json>` to start a local replica.\n',
  );
  ui.footer('Docs', 'https://github.com/TaxCollector23/carbon#readme');
}

/**
 * Pull `--json` out of argv before citty sees it. citty rejects unknown
 * top-level flags, and threading a global flag through every subcommand
 * definition would be noisy. Handling it here keeps the surface area small.
 */
function extractJsonFlag(argv: string[]): { argv: string[]; json: boolean } {
  let json = false;
  const out: string[] = [];
  for (const arg of argv) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    out.push(arg);
  }
  return { argv: out, json };
}

export async function runCli(rawArgs = process.argv.slice(2)): Promise<void> {
  const { argv, json } = extractJsonFlag(rawArgs);
  if (json) setPrinterMode('json');

  // Kick off the update check and telemetry notice as early as possible so
  // their fire-and-forget I/O overlaps with real command work.
  scheduleUpdateCheck(CARBON_VERSION);
  // Telemetry notice writes to stdout in human mode only; in JSON mode we
  // don't emit ad-hoc prose because it would corrupt the event stream.
  if (!isJson()) {
    void maybeShowNotice((line) => process.stdout.write(line));
  }

  if (argv.length === 0) {
    await printWelcome();
    return;
  }

  const commandName = argv[0] ?? 'unknown';
  track('command.start', { name: commandName });

  try {
    await runMain(main, {
      rawArgs: argv,
      showUsage: renderCarbonUsage,
    });
    const exitCode = process.exitCode ?? 0;
    if (exitCode === 0) {
      track('command.done', { name: commandName, exitCode });
    } else {
      track('command.error', { name: commandName, exitCode });
    }
  } catch (err) {
    // Any exception that escapes runMain is an internal error. We tag it so
    // scripts and CI can distinguish it from an assertion or connectivity
    // failure that a command set deliberately.
    const message = (err as Error).message ?? String(err);
    ui.error(message);
    process.exitCode = process.exitCode ?? EXIT_INTERNAL;
    track('command.error', {
      name: commandName,
      exitCode: process.exitCode,
      message,
    });
  }

  // Reference the imports so tree-shakers keep them — they're part of the
  // public exit-code contract even when unused in the happy path.
  void EXIT_ASSERTION_FAILED;
  void EXIT_CONNECTIVITY;
}

async function renderCarbonUsage<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  process.stdout.write(await renderUsage(cmd, parent));
}

void runCli();
