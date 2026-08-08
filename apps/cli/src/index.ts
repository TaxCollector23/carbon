#!/usr/bin/env node
import { defineCommand, renderUsage, runMain, type ArgsDef, type CommandDef } from 'citty';
import { cliCommandCatalog, cliSubCommands } from './commands.js';
import { ui } from './ui.js';

export const CARBON_VERSION = '0.2.1';

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

function printWelcome(): void {
  ui.welcome(CARBON_VERSION);
  ui.header('Commands');
  ui.commandList(cliCommandCatalog);
  ui.footer('Docs', 'https://github.com/carbon-dev/carbon#readme');
}

export async function runCli(rawArgs = process.argv.slice(2)): Promise<void> {
  ui.banner();
  if (rawArgs.length === 0) {
    printWelcome();
    return;
  }
  await runMain(main, {
    rawArgs,
    showUsage: renderCarbonUsage,
  });
}

async function renderCarbonUsage<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  process.stdout.write(await renderUsage(cmd, parent));
}

void runCli();
