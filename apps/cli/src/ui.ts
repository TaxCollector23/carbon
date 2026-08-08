import pc from 'picocolors';
import { consola } from 'consola';
import type { CliCommandInfo } from './commands.js';

// ANSI Shadow-family glyphs (Unicode block-drawing + shading). Rendered in
// bright white with a cyan gradient hairline on the right so terminals that
// support truecolor get an accent without breaking mono terminals — plain
// braille dots look correct even without color support.
const CARBON_GLYPHS = [
  ' ██████╗  █████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗',
  '██╔════╝ ██╔══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║',
  '██║      ███████║██████╔╝██████╔╝██║   ██║██╔██╗ ██║',
  '██║      ██╔══██║██╔══██╗██╔══██╗██║   ██║██║╚██╗██║',
  '╚██████╗ ██║  ██║██║  ██║██████╔╝╚██████╔╝██║ ╚████║',
  ' ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝',
];

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
    const lines = CARBON_GLYPHS.map((line, i) => {
      // Fade the last three columns to cyan to signal "runtime". Everything
      // else is bold white so the wordmark reads instantly in dark and light
      // terminals.
      const cut = Math.max(0, line.length - 20);
      const head = line.slice(0, cut);
      const tail = line.slice(cut);
      const accent = i % 2 === 0 ? pc.cyan(tail) : pc.blue(tail);
      return `${pc.white(pc.bold(head))}${accent}`;
    });
    process.stdout.write(`\n${lines.join('\n')}\n`);
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
