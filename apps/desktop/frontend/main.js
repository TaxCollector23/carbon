'use strict';

const invoke = window.__TAURI__?.core?.invoke;

const els = {
  spec: document.getElementById('spec'),
  port: document.getElementById('port'),
  start: document.getElementById('start'),
  stop: document.getElementById('stop'),
  status: document.getElementById('status'),
  inspect: document.getElementById('inspect'),
  history: document.getElementById('history'),
};

let runningUrl = null;
let pollTimer = null;

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = `status ${kind || 'idle'}`;
}

function setRunning(url) {
  runningUrl = url;
  els.start.disabled = true;
  els.stop.disabled = false;
  setStatus(`Running at ${url}`, 'running');
}

function setIdle() {
  runningUrl = null;
  els.start.disabled = false;
  els.stop.disabled = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  setStatus('Stopped', 'idle');
}

async function start() {
  const spec = els.spec.value.trim();
  const port = Number(els.port.value);
  if (!spec) {
    setStatus('Enter a spec path or URL first.', 'error');
    return;
  }
  setStatus('Starting…', 'pending');
  try {
    const url = await invoke('emulate', { spec, port });
    setRunning(url);
    await poll();
    pollTimer = setInterval(poll, 2000);
  } catch (err) {
    setStatus(String(err), 'error');
  }
}

async function stop() {
  try {
    await invoke('stop');
  } catch (err) {
    // best-effort; still reset the UI
  }
  setIdle();
  els.inspect.textContent = 'Start an emulator to see its endpoints, resources, and relationships.';
  els.history.textContent = 'Create or update records to see the mutation journal.';
}

async function poll() {
  if (!runningUrl) return;
  try {
    const inspect = await invoke('inspect', { url: runningUrl });
    els.inspect.textContent = JSON.stringify(inspect, null, 2);
  } catch (err) {
    els.inspect.textContent = `inspect failed: ${err}`;
  }
  try {
    const history = await invoke('history', { url: runningUrl });
    els.history.textContent = JSON.stringify(history, null, 2);
  } catch (err) {
    els.history.textContent = `history failed: ${err}`;
  }
}

els.start.addEventListener('click', start);
els.stop.addEventListener('click', stop);

if (!invoke) {
  setStatus('Tauri API not available — run via `pnpm --filter @carbon/desktop dev`.', 'error');
  els.start.disabled = true;
}
