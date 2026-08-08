import pc from 'picocolors';
import { consola } from 'consola';
import type { CliCommandInfo } from './commands.js';

const CARBON_ASCII = `
   CCCCC   AAAAA   RRRRR   BBBBB    OOOOO   N   N
  C       A     A  R    R  B    B  O     O  NN  N
  C       AAAAAAA  RRRRR   BBBBB   O     O  N N N
  C       A     A  R   R   B    B  O     O  N  NN
   CCCCC  A     A  R    R  BBBBB    OOOOO   N   N
`.trimEnd();

export const ui = {
  info(msg: string) {
    consola.info(msg);
  },
  success(msg: string) {
    consola.success(msg);
  },
  warn(msg: string) {
    consola.warn(msg);
  },
  error(msg: string) {
    consola.error(msg);
  },
  step(label: string, detail?: string) {
    process.stdout.write(`${pc.dim('›')} ${label}${detail ? pc.dim(` — ${detail}`) : ''}\n`);
  },
  code(text: string) {
    return pc.cyan(text);
  },
  header(name: string) {
    process.stdout.write(`\n${pc.bold(name)}\n`);
  },
  banner() {
    process.stdout.write(`${pc.white(CARBON_ASCII)}\n`);
  },
  welcome(version: string) {
    process.stdout.write(`\n${pc.dim(`carbon v${version}`)}\n`);
    process.stdout.write(
      `\n${pc.bold('Get started:')} ${pc.cyan('carbon init')} ${pc.dim('— scaffold a new project')}\n`,
    );
  },
  footer(label: string, detail: string) {
    process.stdout.write(`\n${pc.dim(`${label}: ${detail}`)}\n`);
  },
  commandList(commands: readonly CliCommandInfo[]) {
    const width = commands.reduce((max, command) => Math.max(max, command.command.length), 0);
    for (const command of commands) {
      process.stdout.write(
        `  ${pc.white(command.command.padEnd(width))}  ${pc.dim(command.description)}\n`,
      );
    }
  },
};
