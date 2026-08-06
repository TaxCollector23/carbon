import { Input, Kbd } from '@carbon/ui';
import { Bell } from 'lucide-react';

export function Topbar({ title }: { title: string }) {
  return (
    <div className="flex h-14 items-center justify-between border-b border-border bg-background px-6">
      <h1 className="text-base font-medium tracking-tight">{title}</h1>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Input placeholder="Search projects…" className="w-72 pr-14" />
          <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </div>
        </div>
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
