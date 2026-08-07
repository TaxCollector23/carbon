'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@carbon/ui/cn';

type Line =
  | { kind: 'prompt'; command: string; typedMs?: number }
  | { kind: 'output'; text: string; muted?: boolean; delayMs?: number }
  | { kind: 'blank' };

const script: Line[] = [
  { kind: 'prompt', command: 'carbon init', typedMs: 900 },
  { kind: 'output', text: '✓ Workspace linked: acme', delayMs: 400 },
  { kind: 'output', text: '✓ carbon.config.ts created', delayMs: 200 },
  { kind: 'blank' },
  { kind: 'prompt', command: 'carbon record https://api.stripe.com', typedMs: 1400 },
  { kind: 'output', text: '→ observing traffic on port 8787', muted: true, delayMs: 300 },
  { kind: 'output', text: '↳ 142 requests · 12 resources · 4 relationships', delayMs: 900 },
  { kind: 'output', text: '↳ inferring behavior graph…', muted: true, delayMs: 500 },
  { kind: 'output', text: '✓ recording saved · rec_9f3ac2', delayMs: 800 },
  { kind: 'blank' },
  { kind: 'prompt', command: 'carbon emulate', typedMs: 700 },
  { kind: 'output', text: '● runtime ready at http://localhost:8787', delayMs: 900 },
  {
    kind: 'output',
    text: '● state engine · in-memory · snapshot: fresh',
    muted: true,
    delayMs: 200,
  },
  {
    kind: 'output',
    text: '● 12 resources · 38 endpoints · deterministic',
    muted: true,
    delayMs: 200,
  },
];

export function TerminalDemo({ className }: { className?: string }) {
  const [visible, setVisible] = useState<Line[]>([]);
  const [typing, setTyping] = useState<{ command: string; progress: number } | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const run = async () => {
      while (!cancelled.current) {
        setVisible([]);
        setTyping(null);
        await wait(400);
        for (const line of script) {
          if (cancelled.current) return;
          if (line.kind === 'prompt') {
            const duration = line.typedMs ?? 800;
            const steps = Math.max(6, Math.min(24, line.command.length));
            for (let i = 1; i <= steps; i++) {
              if (cancelled.current) return;
              setTyping({
                command: line.command.slice(0, Math.ceil((i / steps) * line.command.length)),
                progress: i / steps,
              });
              await wait(duration / steps);
            }
            setVisible((v) => [...v, line]);
            setTyping(null);
            await wait(220);
          } else if (line.kind === 'output') {
            await wait(line.delayMs ?? 200);
            if (cancelled.current) return;
            setVisible((v) => [...v, line]);
          } else {
            setVisible((v) => [...v, line]);
            await wait(120);
          }
        }
        await wait(3800);
      }
    };
    run();
    return () => {
      cancelled.current = true;
    };
  }, []);

  return (
    <div
      className={cn(
        'border-border overflow-hidden rounded-lg border bg-[hsl(226_18%_14%)] text-[hsl(220_10%_92%)] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.4)]',
        className,
      )}
      aria-label="Carbon CLI preview"
    >
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
        </div>
        <span className="text-2xs font-mono uppercase tracking-widest text-white/40">
          ~/acme · carbon
        </span>
        <span className="h-2.5 w-2.5" />
      </div>
      <pre className="min-h-[320px] whitespace-pre-wrap px-5 py-4 font-mono text-[13px] leading-6">
        <code>
          {visible.map((line, i) => (
            <LineView key={i} line={line} />
          ))}
          {typing ? (
            <>
              <span className="text-white/40">$ </span>
              <span>{typing.command}</span>
              <span className="animate-blink ml-0.5 inline-block h-4 w-1.5 -translate-y-[1px] bg-white/70 align-middle" />
              {'\n'}
            </>
          ) : (
            <>
              <span className="text-white/40">$ </span>
              <span className="animate-blink ml-0.5 inline-block h-4 w-1.5 -translate-y-[1px] bg-white/70 align-middle" />
            </>
          )}
        </code>
      </pre>
    </div>
  );
}

function LineView({ line }: { line: Line }) {
  if (line.kind === 'blank') return <>{'\n'}</>;
  if (line.kind === 'prompt') {
    return (
      <>
        <span className="text-white/40">$ </span>
        <span>{line.command}</span>
        {'\n'}
      </>
    );
  }
  return (
    <>
      <span className={cn(line.muted ? 'text-white/45' : 'text-white/85')}>{line.text}</span>
      {'\n'}
    </>
  );
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
