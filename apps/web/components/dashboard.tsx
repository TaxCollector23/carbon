'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Box,
  Chrome,
  Database,
  GaugeCircle,
  Github,
  History,
  KeyRound,
  Layers,
  LockKeyhole,
  LogOut,
  Settings,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type AuthProvider,
} from 'firebase/auth';
import { buttonVariants, cn } from '@carbon/ui';
import { auth, githubProvider, googleProvider, loadAnalytics } from '@/lib/firebase';
import { Wordmark } from './logo';
import { ThemeToggle } from './theme-toggle';

type DashboardAuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: { name: string; email: string } };

const navItems: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: GaugeCircle },
  { id: 'projects', label: 'Projects', icon: Box },
  { id: 'graphs', label: 'Graphs', icon: Waypoints },
  { id: 'snapshots', label: 'Snapshots', icon: Layers },
  { id: 'recordings', label: 'Recordings', icon: History },
  { id: 'state', label: 'State', icon: Database },
  { id: 'api-keys', label: 'API keys', icon: KeyRound },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const emptySections: Array<{ id: string; title: string; body: string; icon: LucideIcon }> = [
  {
    id: 'projects',
    title: 'No projects yet',
    body: 'Import a spec or recording to create your first project.',
    icon: Box,
  },
  {
    id: 'graphs',
    title: 'No behavior graphs yet',
    body: 'Ingest an API to build the graph Carbon will emulate.',
    icon: Waypoints,
  },
  {
    id: 'snapshots',
    title: 'No snapshots yet',
    body: 'Save runtime state when you have a test setup worth reusing.',
    icon: Layers,
  },
  {
    id: 'recordings',
    title: 'No recordings yet',
    body: 'Run `carbon record <url>` to capture traffic.',
    icon: History,
  },
  {
    id: 'state',
    title: 'No saved state yet',
    body: 'State will appear after you start a runtime and create resources.',
    icon: Database,
  },
  {
    id: 'api-keys',
    title: 'No API keys yet',
    body: 'Create keys from the API when you are ready to connect CLI or CI workflows.',
    icon: KeyRound,
  },
  {
    id: 'settings',
    title: 'No workspace settings yet',
    body: 'Team settings will appear after the workspace backend is connected.',
    icon: Settings,
  },
];

export function DashboardRoute() {
  const [authState, setAuthState] = useState<DashboardAuthState>({ status: 'loading' });
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    void loadAnalytics();
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        setAuthState({ status: 'signed-out' });
        return;
      }
      setAuthState({
        status: 'signed-in',
        user: {
          name: user.displayName ?? user.email ?? 'Signed-in user',
          email: user.email ?? '',
        },
      });
    });
  }, []);

  async function signIn(provider: AuthProvider) {
    setAuthError(null);
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      setAuthError(errorMessage(err));
    }
  }

  async function signOut() {
    setAuthError(null);
    await firebaseSignOut(auth);
  }

  if (authState.status === 'loading') {
    return (
      <DashboardFrame title="Dashboard">
        <DashboardLoading />
      </DashboardFrame>
    );
  }

  if (authState.status === 'signed-out') {
    return (
      <DashboardFrame title="Dashboard">
        <DashboardGate
          error={authError}
          onGoogle={() => signIn(googleProvider)}
          onGithub={() => signIn(githubProvider)}
        />
      </DashboardFrame>
    );
  }

  return (
    <DashboardFrame title="Overview" userLabel={authState.user.name} onSignOut={signOut}>
      <DashboardEmptyState />
    </DashboardFrame>
  );
}

function DashboardFrame({
  title,
  userLabel,
  onSignOut,
  children,
}: {
  title: string;
  userLabel?: string;
  onSignOut?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="bg-background text-foreground min-h-dvh md:flex">
      <aside className="border-border bg-background md:min-h-dvh md:w-64 md:border-r">
        <div className="border-border flex h-16 items-center border-b px-4">
          <Link href="/" aria-label="Carbon home">
            <Wordmark />
          </Link>
        </div>
        <nav aria-label="Dashboard" className="flex gap-1 overflow-x-auto p-3 md:flex-col">
          {navItems.map(({ id, label, icon: Icon }, index) => (
            <Link
              key={id}
              href={`/dashboard#${id}`}
              className={cn(
                'flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors md:min-w-0',
                index === 0
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="border-border bg-background/90 flex h-16 items-center justify-between gap-4 border-b px-4 backdrop-blur sm:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-base font-medium tracking-tight">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {userLabel ? (
              <span className="text-muted-foreground hidden max-w-48 truncate text-sm sm:inline">
                {userLabel}
              </span>
            ) : null}
            {onSignOut ? (
              <button
                type="button"
                onClick={onSignOut}
                className="hover:bg-muted focus-visible:ring-ring text-muted-foreground hover:text-foreground grid h-9 w-9 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            ) : null}
            <ThemeToggle />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function DashboardGate({
  error,
  onGoogle,
  onGithub,
}: {
  error: string | null;
  onGoogle: () => void;
  onGithub: () => void;
}) {
  return (
    <main id="main" className="p-6 sm:p-8">
      <section className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-2xl items-center">
        <div className="border-border w-full border-y py-8">
          <div className="bg-muted grid h-11 w-11 place-items-center rounded-md">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <h2 className="mt-6 text-2xl font-medium tracking-tight">
            Sign in to enter the dashboard
          </h2>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            Use Google or GitHub to access the workspace. API keys stay on the backend for CLI and
            CI workflows.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={onGoogle}
              className={cn(buttonVariants({ size: 'lg' }), 'gap-2')}
            >
              <Chrome className="h-4 w-4" />
              Continue with Google
            </button>
            <button
              type="button"
              onClick={onGithub}
              className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'gap-2')}
            >
              <Github className="h-4 w-4" />
              Continue with GitHub
            </button>
          </div>
          {error ? <p className="text-destructive mt-4 text-sm">{error}</p> : null}
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground mt-7 inline-flex text-sm"
          >
            Back to landing
          </Link>
        </div>
      </section>
    </main>
  );
}

function DashboardEmptyState() {
  return (
    <main id="main" className="p-6 sm:p-8">
      <section id="overview" className="border-border border-y py-7">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-medium tracking-tight">No workspace data yet</h2>
            <p className="text-muted-foreground mt-3 text-sm leading-6">
              Projects, graphs, snapshots, recordings, and keys will appear here after your
              workspace is connected.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/#cli" className={buttonVariants({ variant: 'secondary' })}>
              Install CLI
            </Link>
            <Link href="/benchmarks" className={buttonVariants({ variant: 'ghost' })}>
              View benchmarks
            </Link>
          </div>
        </div>
      </section>

      <section className="border-border mt-8 divide-y border-y">
        {emptySections.map(({ id, title, body, icon: Icon }) => (
          <a
            key={id}
            id={id}
            href={`#${id}`}
            className="hover:bg-muted/40 group grid scroll-mt-6 gap-4 py-6 transition-colors sm:grid-cols-[3rem_1fr]"
          >
            <Icon className="text-muted-foreground group-hover:text-foreground h-5 w-5 transition-colors" />
            <div>
              <h3 className="text-sm font-medium">{title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-6">{body}</p>
            </div>
          </a>
        ))}
      </section>
    </main>
  );
}

function DashboardLoading() {
  return (
    <main id="main" className="p-6 sm:p-8">
      <section className="border-border border-y py-7">
        <div className="bg-muted h-5 w-40 animate-pulse rounded" />
        <div className="bg-muted mt-4 h-16 max-w-2xl animate-pulse rounded" />
      </section>
    </main>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Sign in failed. Check that the provider is enabled in Firebase and try again.';
}
