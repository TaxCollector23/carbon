import * as React from 'react';
import { cn } from '../lib/cn';

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'border-border bg-muted text-2xs text-muted-foreground inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border px-1.5 font-mono font-medium',
        className,
      )}
      {...props}
    />
  );
}
