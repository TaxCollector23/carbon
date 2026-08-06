import pc from 'picocolors';
import { consola } from 'consola';

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
};
