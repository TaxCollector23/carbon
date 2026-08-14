import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { carbon, type Replica } from '@carbon/sdk';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createDefaultParserRegistry, createParserContext } from '@carbon/parser';
import { createLogger } from '@carbon/core';
import { renderGraphHtml } from './webviews/graph-panel.js';

/**
 * VS Code extension entry. Registers four commands — emulate, inspectGraph,
 * newProject, viewLogs — plus shared status-bar/output-channel plumbing so
 * a running replica is visible and stoppable from the workspace UI.
 */

interface RunningReplica {
  replica: Replica;
  specPath: string;
  status: vscode.StatusBarItem;
}

const CONFIG_TEMPLATE = `import { defineConfig } from '@carbon/core/config';

export default defineConfig({
  project: {
    name: '__NAME__',
    slug: '__SLUG__',
  },
  runtime: {
    port: 8787,
  },
});
`;

let current: RunningReplica | null = null;
let output: vscode.OutputChannel | null = null;

function getOutput(): vscode.OutputChannel {
  if (!output) output = vscode.window.createOutputChannel('Carbon');
  return output;
}

async function pickSpec(): Promise<vscode.Uri | null> {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === 'file') return editor.document.uri;
  const found = await vscode.workspace.findFiles(
    '**/*.{yaml,yml,json,graphql,proto,har}',
    '**/node_modules/**',
    50,
  );
  if (found.length === 0) {
    void vscode.window.showWarningMessage('Carbon: no spec files found in workspace.');
    return null;
  }
  const pick = await vscode.window.showQuickPick(
    found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u })),
    { placeHolder: 'Select an API spec to emulate' },
  );
  return pick ? pick.uri : null;
}

async function stopCurrent(): Promise<void> {
  if (!current) return;
  const r = current;
  current = null;
  r.status.hide();
  r.status.dispose();
  try {
    await r.replica.close();
    getOutput().appendLine(`[carbon] stopped replica for ${r.specPath}`);
  } catch (err) {
    getOutput().appendLine(`[carbon] error stopping replica: ${(err as Error).message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('carbon.emulate', async () => {
      if (current) {
        const answer = await vscode.window.showInformationMessage(
          `Carbon is already emulating ${current.specPath}. Stop it first?`,
          'Stop',
          'Cancel',
        );
        if (answer !== 'Stop') return;
        await stopCurrent();
      }
      const uri = await pickSpec();
      if (!uri) return;
      const cfg = vscode.workspace.getConfiguration('carbon');
      const out = getOutput();
      out.appendLine(`[carbon] booting replica for ${uri.fsPath}`);
      try {
        const replica = await carbon.emulate({ from: uri.fsPath, port: 0 });
        const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        status.text = `$(radio-tower) Carbon: ${replica.url}`;
        status.tooltip = `Emulating ${uri.fsPath}\nClick to stop`;
        status.command = 'carbon.stopEmulate';
        status.show();
        current = { replica, specPath: uri.fsPath, status };
        out.appendLine(`[carbon] listening on ${replica.url}`);
        if (cfg.get<boolean>('telemetry', false)) {
          out.appendLine(`[carbon] telemetry enabled`);
        }
        void vscode.window.showInformationMessage(`Carbon replica running at ${replica.url}`);
      } catch (err) {
        out.appendLine(`[carbon] emulate failed: ${(err as Error).message}`);
        void vscode.window.showErrorMessage(`Carbon: emulate failed — ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('carbon.stopEmulate', stopCurrent),

    vscode.commands.registerCommand('carbon.inspectGraph', async () => {
      const uri = await pickSpec();
      if (!uri) return;
      const panel = vscode.window.createWebviewPanel(
        'carbon.graph',
        'Carbon: Behavior Graph',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      panel.webview.html =
        '<html><body style="font-family:sans-serif;padding:1rem">Building graph…</body></html>';
      try {
        const parsers = createDefaultParserRegistry();
        const logger = createLogger({ level: 'info', pretty: false, name: 'vscode' });
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        let input;
        try {
          input = { kind: 'json' as const, content: JSON.parse(text) };
        } catch {
          input = { kind: 'text' as const, content: text };
        }
        const ir = await parsers.parse(input, createParserContext(logger));
        const graph = new BehaviorGraphBuilder().build(ir);
        panel.webview.html = renderGraphHtml({
          resources: ir.resources.map((r) => ({ id: r.id, name: r.name })),
          nodes: graph.nodes.map((n) => ({
            id: n.id,
            name: n.name,
            readers: n.readers.length,
            writers: n.writers.length,
          })),
          edges: graph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
          transitions: graph.transitions.length,
          constraints: graph.constraints.length,
          raw: graph,
        });
      } catch (err) {
        panel.webview.html = `<html><body style="font-family:sans-serif;padding:1rem;color:#c00"><h3>Failed to build graph</h3><pre>${escapeHtml(
          (err as Error).message,
        )}</pre></body></html>`;
      }
    }),

    vscode.commands.registerCommand('carbon.newProject', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage('Carbon: open a workspace folder first.');
        return;
      }
      const cwd = folder.uri.fsPath;
      const target = join(cwd, 'carbon.config.ts');
      if (existsSync(target)) {
        const answer = await vscode.window.showWarningMessage(
          'carbon.config.ts already exists. Overwrite?',
          'Overwrite',
          'Cancel',
        );
        if (answer !== 'Overwrite') return;
      }
      const name = await vscode.window.showInputBox({
        prompt: 'Project name',
        value: folder.name,
      });
      if (!name) return;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const content = CONFIG_TEMPLATE.replace('__NAME__', name).replace('__SLUG__', slug);
      await writeFile(target, content, 'utf8');
      await mkdir(join(cwd, '.carbon'), { recursive: true });
      const openDoc = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(openDoc);
      void vscode.window.showInformationMessage(`Carbon: initialized project ${name}`);
    }),

    vscode.commands.registerCommand('carbon.viewLogs', () => {
      getOutput().show(true);
    }),

    { dispose: () => void stopCurrent() },
  );
}

export function deactivate(): void {
  void stopCurrent();
  if (output) output.dispose();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
