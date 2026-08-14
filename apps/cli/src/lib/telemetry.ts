import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform, release } from 'node:os';

const TELEMETRY_FILE = join(homedir(), '.carbon', 'telemetry.json');
const HARD_TIMEOUT_MS = 500;

interface TelemetryState {
  deviceId: string;
  noticeShown?: boolean;
  createdAt: string;
}

let cached: TelemetryState | null = null;

/**
 * Anonymous, opt-out telemetry.
 *
 * `track` is fire-and-forget: it never awaits network I/O, never throws, and
 * always caps its background work at HARD_TIMEOUT_MS so a hung endpoint can't
 * delay CLI exit. Setting `CARBON_TELEMETRY=0|false|off` disables it entirely
 * (no file writes, no network).
 */
export function track(event: string, data: Record<string, unknown> = {}): void {
  if (!isEnabled()) return;
  setImmediate(() => {
    void sendSafely(event, data);
  });
}

export function isEnabled(): boolean {
  const flag = (process.env.CARBON_TELEMETRY ?? '').toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') return false;
  return telemetryEndpoint() !== null;
}

/**
 * Show the one-time telemetry notice if we haven't yet. Safe to call on every
 * CLI invocation — it early-exits after the first display.
 */
export async function maybeShowNotice(write: (line: string) => void): Promise<void> {
  if (!isEnabled()) return;
  const state = await loadOrCreate();
  if (state.noticeShown) return;
  write(
    'Anonymous usage telemetry is enabled (command names + success only, no payload data). Opt out with CARBON_TELEMETRY=0.\n',
  );
  state.noticeShown = true;
  await persist(state);
}

async function sendSafely(event: string, data: Record<string, unknown>): Promise<void> {
  try {
    const state = await loadOrCreate();
    const endpoint = telemetryEndpoint();
    if (!endpoint) return;
    const version = process.env.CARBON_VERSION ?? 'unknown';
    const payload = {
      event,
      deviceId: state.deviceId,
      version,
      platform: `${platform()} ${release()}`,
      node: process.versions.node,
      ...data,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Telemetry is never allowed to surface errors to the user.
  }
}

function telemetryEndpoint(): string | null {
  const endpoint = process.env.CARBON_TELEMETRY_URL?.trim();
  return endpoint && endpoint.length > 0 ? endpoint : null;
}

async function loadOrCreate(): Promise<TelemetryState> {
  if (cached) return cached;
  try {
    const text = await readFile(TELEMETRY_FILE, 'utf8');
    const parsed = JSON.parse(text) as Partial<TelemetryState>;
    if (parsed.deviceId) {
      cached = {
        deviceId: parsed.deviceId,
        noticeShown: parsed.noticeShown ?? false,
        createdAt: parsed.createdAt ?? new Date().toISOString(),
      };
      return cached;
    }
  } catch {
    // fall through to create
  }
  const fresh: TelemetryState = {
    deviceId: randomUUID(),
    noticeShown: false,
    createdAt: new Date().toISOString(),
  };
  cached = fresh;
  await persist(fresh);
  return fresh;
}

async function persist(state: TelemetryState): Promise<void> {
  try {
    await mkdir(join(homedir(), '.carbon'), { recursive: true, mode: 0o700 });
    await writeFile(TELEMETRY_FILE, JSON.stringify(state, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // Best-effort — a read-only home directory shouldn't crash the CLI.
  }
}
