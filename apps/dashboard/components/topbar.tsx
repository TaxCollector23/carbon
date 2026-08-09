import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export function Topbar({ title }: { title: string }) {
  return (
    <div className="border-border bg-background flex h-14 items-center justify-between border-b px-6">
      <h1 className="text-base font-medium tracking-tight">{title}</h1>
      <div className="flex items-center gap-3">
        <UserMenu />
        <ThemeToggle />
      </div>
    </div>
  );
}
