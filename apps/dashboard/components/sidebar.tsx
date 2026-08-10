'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Box,
  Cog,
  Database,
  FlaskConical,
  Flag,
  GaugeCircle,
  History,
  KeyRound,
  Layers,
  ListChecks,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import { cn } from '@carbon/ui/cn';

const items = [
  { href: '/', label: 'Overview', icon: GaugeCircle },
  { href: '/projects', label: 'Projects', icon: Box },
  { href: '/graphs', label: 'Graphs', icon: Waypoints },
  { href: '/snapshots', label: 'Snapshots', icon: Layers },
  { href: '/recordings', label: 'Recordings', icon: History },
  { href: '/state', label: 'State', icon: Database },
  { href: '/chaos-presets', label: 'Chaos presets', icon: FlaskConical },
  { href: '/ai-quality', label: 'AI quality', icon: ShieldCheck },
  { href: '/usage', label: 'Usage', icon: Activity },
  { href: '/jobs', label: 'Jobs', icon: ListChecks },
  { href: '/keys', label: 'API keys', icon: KeyRound },
  { href: '/feature-flags', label: 'Feature flags', icon: Flag },
  { href: '/settings', label: 'Settings', icon: Cog },
];

export function Sidebar() {
  const pathname = usePathname();

  // Sign-in/sign-up chromeless; render nothing so the auth screens are
  // centered by their own layouts without a workspace nav next to them.
  if (pathname === '/sign-in' || pathname === '/sign-up') return null;

  return (
    <aside className="border-border bg-subtle/30 flex h-dvh w-60 shrink-0 flex-col border-r px-3 py-4">
      <div className="px-3 py-2 text-sm font-medium tracking-tight">Carbon</div>
      <nav className="mt-2 flex flex-1 flex-col gap-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'text-muted-foreground flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'hover:bg-background/60 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="text-muted-foreground px-3 pt-4 text-xs">v0.1 · local</div>
    </aside>
  );
}
