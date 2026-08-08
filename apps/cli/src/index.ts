#!/usr/bin/env node
import { defineCommand, renderUsage, runMain, type ArgsDef, type CommandDef } from 'citty';
import { cliCommandCatalog, cliSubCommands } from './commands.js';
import { ui } from './ui.js';

export const CARBON_VERSION = '0.2.0';

export const main = defineCommand({
  meta: {
    name: 'carbon',
    version: CARBON_VERSION,
    description: 'Build and run stateful API replicas for development, tests, and CI.',
  },
  subCommands: cliSubCommands,
  run() {
    ui.welcome(CARBON_VERSION);
    ui.header('Commands');
    ui.commandList(cliCommandCatalog);
    ui.footer('Docs', 'https://carbondev.com/docs');
  },
});

export async function runCli(rawArgs = process.argv.slice(2)): Promise<void> {
  ui.banner();
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
