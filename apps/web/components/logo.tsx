import { cn } from '@carbon/ui/cn';

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-5 w-5', className)}
      aria-hidden
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="currentColor" />
      <path d="M17 7h-5a5 5 0 1 0 0 10h5v-2.3h-5a2.7 2.7 0 1 1 0-5.4h5V7Z" fill="hsl(var(--background))" />
      <circle cx="18" cy="6" r="1.45" fill="var(--c2-lime, currentColor)" />
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
