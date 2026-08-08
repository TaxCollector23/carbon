import pc from 'picocolors';
import { consola } from 'consola';
import type { CliCommandInfo } from './commands.js';
import { getPrinter, isJson } from './lib/printer.js';

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

/**
 * All user-visible output routes through this module.
 *
 * In human mode the methods print colored lines via consola / picocolors.
 * In JSON mode (see `lib/printer.ts`) every call also emits one structured
 * `{event, level, data}` line to stdout, and decorative helpers (banner,
 * commandList, footer, header) become no-ops so scripts see clean JSON.
 */
export const ui = {
  info(msg: string) {
    getPrinter().emit({ event: 'info', level: 'info', data: { message: msg } });
    if (!isJson()) consola.info(msg);
  },
  success(msg: string) {
    getPrinter().emit({ event: 'success', level: 'success', data: { message: msg } });
    if (!isJson()) consola.success(msg);
  },
  warn(msg: string) {
    getPrinter().emit({ event: 'warn', level: 'warn', data: { message: msg } });
    if (!isJson()) consola.warn(msg);
  },
  error(msg: string) {
    getPrinter().emit({ event: 'error', level: 'error', data: { message: msg } });
    if (!isJson()) consola.error(msg);
  },
  step(label: string, detail?: string) {
    getPrinter().emit({
      event: 'step',
      level: 'info',
      data: detail !== undefined ? { label, detail } : { label },
    });
    if (!isJson()) {
      process.stdout.write(`${pc.dim('›')} ${label}${detail ? pc.dim(` — ${detail}`) : ''}\n`);
    }
  },
  code(text: string) {
    return isJson() ? text : pc.cyan(text);
  },
  header(name: string) {
    if (isJson()) return;
    process.stdout.write(`\n${pc.bold(name)}\n`);
  },
  banner() {
    if (isJson()) return;
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
    if (isJson()) {
      getPrinter().emit({ event: 'welcome', level: 'info', data: { version } });
      return;
    }
    process.stdout.write(`\n${pc.dim(`carbon v${version}`)}\n`);
    process.stdout.write(
      `\n${pc.bold('Get started:')} ${pc.cyan('carbon init')} ${pc.dim('— scaffold a new project')}\n`,
    );
  },
  footer(label: string, detail: string) {
    if (isJson()) return;
    process.stdout.write(`\n${pc.dim(`${label}: ${detail}`)}\n`);
  },
  commandList(commands: readonly CliCommandInfo[]) {
    if (isJson()) return;
    const width = commands.reduce((max, command) => Math.max(max, command.command.length), 0);
    for (const command of commands) {
      process.stdout.write(
        `  ${pc.white(command.command.padEnd(width))}  ${pc.dim(command.description)}\n`,
      );
    }
  },
  /**
   * Emit an arbitrary structured event. Useful for commands that want a
   * machine-parseable tag (e.g. `replay` result category) without inventing a
   * new colored line format. In human mode a compact prefix line is printed.
   */
  event(name: string, data: Record<string, unknown> = {}, level: 'info' | 'warn' | 'error' = 'info') {
    getPrinter().emit({ event: name, level, data });
    if (!isJson()) {
      const parts = Object.entries(data)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ');
      const color = level === 'error' ? pc.red : level === 'warn' ? pc.yellow : pc.dim;
      process.stdout.write(`${color(`[${name}]`)} ${parts}\n`);
    }
  },
};
