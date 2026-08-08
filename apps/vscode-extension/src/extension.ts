import * as vscode from 'vscode';
import { carbon } from '@carbon/sdk';
import { BehaviorGraphBuilder } from '@carbon/graph';
import { createDefaultParserRegistry, createParserContext } from '@carbon/parser';
import { createLogger } from '@carbon/core';

/**
 * VS Code extension entry. Two commands, both stubs suitable for local
 * development: `carbon.emulate` boots a replica from the active editor's
 * spec file, and `carbon.inspectGraph` opens a webview showing the derived
 * behavior graph as JSON.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('carbon.emulate', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('Open a spec file first.');
        return;
      }
      try {
        const replica = await carbon.emulate({ from: editor.document.uri.fsPath, port: 0 });
        void vscode.window.showInformationMessage(`Carbon replica running at ${replica.url}`);
        context.subscriptions.push({
          dispose: () => {
            void replica.close();
          },
        });
      } catch (err) {
        void vscode.window.showErrorMessage(`Emulate failed: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('carbon.inspectGraph', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('Open a spec file first.');
        return;
      }
      const panel = vscode.window.createWebviewPanel(
        'carbon.graph',
        'Carbon: Behavior Graph',
        vscode.ViewColumn.Beside,
        { enableScripts: false },
      );
      panel.webview.html = '<html><body><p>Building graph…</p></body></html>';
      try {
        const parsers = createDefaultParserRegistry();
        const logger = createLogger({ level: 'info', pretty: false, name: 'vscode' });
        const text = editor.document.getText();
        let input;
        try {
          input = { kind: 'json' as const, content: JSON.parse(text) };
        } catch {
          input = { kind: 'text' as const, content: text };
        }
        const ir = await parsers.parse(input, createParserContext(logger));
        const graph = new BehaviorGraphBuilder().build(ir);
        panel.webview.html = renderGraphHtml(graph);
      } catch (err) {
        panel.webview.html = `<html><body><pre>Failed: ${escape(
          (err as Error).message,
        )}</pre></body></html>`;
      }
    }),
  );
}

export function deactivate(): void {
  // no-op
}

function renderGraphHtml(graph: unknown): string {
  const json = escape(JSON.stringify(graph, null, 2));
  return `<!doctype html><html><body style="font-family: monospace">
<h3>Behavior Graph</h3>
<pre style="white-space: pre-wrap">${json}</pre>
</body></html>`;
}

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
