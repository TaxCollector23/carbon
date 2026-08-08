/**
 * Output printer abstraction.
 *
 * The CLI has two output modes:
 *   - `human`  — colored, prose-y lines for a terminal user.
 *   - `json`   — one JSON object per line, structured as
 *                `{ event, level, data }`, for scripting.
 *
 * `ui.ts` layers a friendly API on top of a printer implementation. To flip
 * modes, call `setPrinterMode('json')` before commands run — `index.ts` does
 * this after stripping `--json` from argv.
 */

export type PrinterLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';
export type PrinterMode = 'human' | 'json';

export interface PrinterEvent {
  readonly event: string;
  readonly level: PrinterLevel;
  readonly data?: Record<string, unknown>;
}

export interface Printer {
  readonly mode: PrinterMode;
  emit(evt: PrinterEvent): void;
  /**
   * Raw human-only line. In JSON mode this is dropped — decorative output
   * (banners, headings, column layouts) doesn't belong in a script's stdout.
   */
  raw(text: string): void;
}

class HumanPrinter implements Printer {
  readonly mode: PrinterMode = 'human';
  emit(_evt: PrinterEvent): void {
    // In human mode the caller (ui.ts) writes rich output directly via raw().
    // emit() is a no-op — kept so the printer interface is uniform.
  }
  raw(text: string): void {
    process.stdout.write(text);
  }
}

class JsonPrinter implements Printer {
  readonly mode: PrinterMode = 'json';
  emit(evt: PrinterEvent): void {
    const line = JSON.stringify({
      event: evt.event,
      level: evt.level,
      ...(evt.data ? { data: evt.data } : {}),
    });
    process.stdout.write(`${line}\n`);
  }
  raw(_text: string): void {
    // Decorative output is suppressed in JSON mode.
  }
}

let active: Printer = new HumanPrinter();

export function getPrinter(): Printer {
  return active;
}

export function setPrinterMode(mode: PrinterMode): void {
  active = mode === 'json' ? new JsonPrinter() : new HumanPrinter();
}

export function isJson(): boolean {
  return active.mode === 'json';
}
