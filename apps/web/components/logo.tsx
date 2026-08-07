import { cn } from '@carbon/ui/cn';

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-5 w-5', className)}
      aria-hidden
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="currentColor" />
      <path
        d="M8 12.2c0-2.3 1.9-4.2 4.2-4.2 1.6 0 3 .9 3.7 2.3"
        stroke="hsl(var(--background))"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M8 12.2c0 2.3 1.9 4.2 4.2 4.2 1.6 0 3-.9 3.7-2.3"
        stroke="hsl(var(--background))"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-medium tracking-tight', className)}>
      <Logo />
      <span>Carbon</span>
    </span>
  );
}
