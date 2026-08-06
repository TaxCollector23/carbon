import Link from 'next/link';
import {
  Box,
  Cog,
  Database,
  GaugeCircle,
  History,
  KeyRound,
  Layers,
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
  { href: '/keys', label: 'API keys', icon: KeyRound },
  { href: '/settings', label: 'Settings', icon: Cog },
];

export function Sidebar({ current }: { current?: string }) {
  return (
    <aside className="flex h-dvh w-60 shrink-0 flex-col border-r border-border bg-subtle/30 px-3 py-4">
      <div className="px-3 py-2 text-sm font-medium tracking-tight">Carbon</div>
      <nav className="mt-2 flex flex-1 flex-col gap-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = current === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors',
                active ? 'bg-background text-foreground shadow-sm' : 'hover:bg-background/60 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 pt-4 text-xs text-muted-foreground">v0.1 · local</div>
    </aside>
  );
}
