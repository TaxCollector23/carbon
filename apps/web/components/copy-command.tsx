'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@carbon/ui';

/**
 * Copyable shell command. Used for install one-liners in the download section.
 */
export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable (permissions, non-secure context). The
      // command is still selectable text, so a failed copy is non-fatal.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'bg-muted/40 text-foreground group flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left font-mono text-sm',
        className,
      )}
      title="Copy to clipboard"
    >
      <span className="truncate">{command}</span>
      {copied ? (
        <Check className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      ) : (
        <Copy className="text-muted-foreground h-3.5 w-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}
