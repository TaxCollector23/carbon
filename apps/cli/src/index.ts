#!/usr/bin/env node
import { defineCommand, renderUsage, runMain, type ArgsDef, type CommandDef } from 'citty';
import { cliCommandCatalog, cliSubCommands } from './commands.js';
import { ui } from './ui.js';

export const main = defineCommand({
  meta: {
    name: 'carbon',
    version: '0.1.0',
    description: 'Build and run stateful API replicas for development, tests, and CI.',
  },
  subCommands: cliSubCommands,
  run() {
    ui.header('Available commands');
    ui.commandList(cliCommandCatalog);
    ui.step('Help', `run ${ui.code('carbon --help')} or ${ui.code('carbon <command> --help')}`);
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
