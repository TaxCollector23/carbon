'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Box,
  Database,
  GaugeCircle,
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
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { buttonVariants, cn } from '@carbon/ui';
import { auth, googleProvider, loadAnalytics } from '@/lib/firebase';
import { Wordmark } from './logo';
import { ThemeToggle } from './theme-toggle';

type DashboardAuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: { name: string; email: string } };

type DashboardSectionId =
  | 'overview'
  | 'projects'
  | 'graphs'
  | 'snapshots'
  | 'recordings'
  | 'state'
  | 'api-keys'
  | 'settings';

type DashboardAction = {
  label: string;
  href: string;
  variant?: 'primary' | 'secondary' | 'ghost';
};

type DashboardSection = {
  id: DashboardSectionId;
  label: string;
  title: string;
  emptyTitle: string;
  body: string;
  icon: LucideIcon;
  details: Array<{ label: string; value: string }>;
  primaryAction?: DashboardAction;
  secondaryAction?: DashboardAction;
};

const dashboardSections: DashboardSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    title: 'Overview',
    emptyTitle: 'Workspace ready for imports',
    body: 'This account is signed in. Start a project from the CLI, then return here to review projects, graphs, recordings, snapshots, runtime state, and API keys.',
    icon: GaugeCircle,
    details: [
      { label: 'Project data', value: 'No imports saved yet' },
      { label: 'Runtime target', value: 'Local replicas run on localhost:8787' },
      { label: 'Next step', value: 'Run carbon init in a repository' },
    ],
    primaryAction: { label: 'Install CLI', href: '/#cli' },
    secondaryAction: { label: 'View inputs', href: '/#integrations', variant: 'ghost' },
  },
  {
    id: 'projects',
    label: 'Projects',
    title: 'Projects',
    emptyTitle: 'No projects imported',
    body: 'Projects are created from specs, collections, recordings, or schema files. Import one from a repository to make it available to the workspace.',
    icon: Box,
    details: [
      {
        label: 'Accepted inputs',
        value: 'OpenAPI, AsyncAPI, protobuf, gRPC, HAR, Postman, GraphQL',
      },
      { label: 'Project source', value: 'CLI imports and recordings' },
      { label: 'Workspace state', value: 'No project metadata saved' },
    ],
    primaryAction: { label: 'Install CLI', href: '/#cli' },
    secondaryAction: { label: 'View supported inputs', href: '/#integrations', variant: 'ghost' },
  },
  {
    id: 'graphs',
    label: 'Graphs',
    title: 'Graphs',
    emptyTitle: 'No behavior graph compiled',
    body: 'Behavior graphs are generated during ingestion from resources, relationships, request examples, and state transitions.',
    icon: Waypoints,
    details: [
      { label: 'Graph source', value: 'Compiled API inputs' },
      { label: 'Request path', value: 'Served by code and the state engine' },
      { label: 'Current graph', value: 'None selected' },
    ],
    primaryAction: { label: 'View pipeline', href: '/#architecture', variant: 'secondary' },
    secondaryAction: { label: 'Compare options', href: '/#comparison', variant: 'ghost' },
  },
  {
    id: 'snapshots',
    label: 'Snapshots',
    title: 'Snapshots',
    emptyTitle: 'No snapshots saved',
    body: 'Snapshots capture runtime state so tests, pull requests, and local runs can start from the same setup.',
    icon: Layers,
    details: [
      { label: 'Snapshot format', value: 'JSON runtime state' },
      { label: 'Restore path', value: 'POST /__carbon/state/restore' },
      { label: 'Current snapshot', value: 'None saved' },
    ],
    primaryAction: { label: 'See SDK usage', href: '/#sdk', variant: 'secondary' },
    secondaryAction: { label: 'Install CLI', href: '/#cli', variant: 'ghost' },
  },
  {
    id: 'recordings',
    label: 'Recordings',
    title: 'Recordings',
    emptyTitle: 'No recordings captured',
    body: 'Recordings are made by proxying local traffic once, redacting sensitive headers, and turning observed exchanges into replayable behavior.',
    icon: History,
    details: [
      { label: 'Capture command', value: 'carbon record <url>' },
      { label: 'Proxy address', value: '127.0.0.1 during capture' },
      { label: 'Current recording', value: 'None saved' },
    ],
    primaryAction: { label: 'See workflow', href: '/#workflow', variant: 'secondary' },
    secondaryAction: { label: 'Install CLI', href: '/#cli', variant: 'ghost' },
  },
  {
    id: 'state',
    label: 'State',
    title: 'State',
    emptyTitle: 'No runtime state saved',
    body: 'Runtime state is created when your app sends requests to a Carbon replica. Writes update future reads through the compiled state engine.',
    icon: Database,
    details: [
      { label: 'Mutation model', value: 'POST, PATCH, PUT, and DELETE update state' },
      { label: 'Rollback', value: 'Restore from a snapshot' },
      { label: 'Current state', value: 'No active runtime selected' },
    ],
    primaryAction: { label: 'See state model', href: '/#solution', variant: 'secondary' },
    secondaryAction: { label: 'View benchmarks', href: '/benchmarks', variant: 'ghost' },
  },
  {
    id: 'api-keys',
    label: 'API keys',
    title: 'API keys',
    emptyTitle: 'No API keys created',
    body: 'Create project keys after a project exists. Until then, use carbon login for account-backed CLI workflows.',
    icon: KeyRound,
    details: [
      { label: 'CLI auth', value: 'carbon login' },
      { label: 'CI usage', value: 'Project-scoped keys' },
      { label: 'Current keys', value: 'None created' },
    ],
    primaryAction: { label: 'Install CLI', href: '/#cli', variant: 'secondary' },
    secondaryAction: { label: 'View plans', href: '/#pricing', variant: 'ghost' },
  },
  {
    id: 'settings',
    label: 'Settings',
    title: 'Settings',
    emptyTitle: 'Workspace settings use defaults',
    body: 'This account is ready for local projects. Team retention, access, and deployment settings can be added when shared workspace features are enabled.',
    icon: Settings,
    details: [
      { label: 'Access', value: 'Signed-in account' },
      { label: 'Retention', value: 'Default local snapshot retention' },
      { label: 'Deployment', value: 'Local runtime' },
    ],
    primaryAction: { label: 'View plans', href: '/#pricing', variant: 'secondary' },
  },
];

export function DashboardRoute() {
  const [authState, setAuthState] = useState<DashboardAuthState>({ status: 'loading' });
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [activeSection, setActiveSection] = useState<DashboardSectionId>('overview');

  useEffect(() => {
    if (!auth) return;
    void loadAnalytics();
    // If we came back from a signInWithRedirect, this completes the handshake.
    // On a plain page load with no redirect in flight, some environments throw
    // `auth/argument-error`; that's a benign "nothing to resolve" and must not
    // be shown to the user, or the gate looks broken on every fresh visit.
    getRedirectResult(auth).catch((err) => {
      if (isFirebaseErrorCode(err, 'auth/argument-error')) return;
      setAuthError(errorMessage(err));
    });
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

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (isDashboardSectionId(hash)) setActiveSection(hash);
  }, []);

  function selectSection(id: DashboardSectionId) {
    setActiveSection(id);
    window.history.replaceState(null, '', `#${id}`);
  }

  async function signInWithGoogle() {
    setAuthError(null);
    setAuthBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      // Popup failed — third-party cookies blocked, browser storage
      // partitioning, or the classic "Database is closing/hidden" IndexedDB
      // race that fires when Firebase's persistence layer resets during the
      // popup handshake. Fall back to a full-page redirect, which always
      // works when the auth domain is authorized in Firebase.
      if (shouldFallbackToRedirect(err)) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return; // the redirect nav takes over
        } catch (redirectErr) {
          setAuthError(errorMessage(redirectErr));
        }
      } else {
        setAuthError(errorMessage(err));
      }
    } finally {
      setAuthBusy(false);
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
        <DashboardGate error={authError} busy={authBusy} onGoogle={signInWithGoogle} />
      </DashboardFrame>
    );
  }

  const section =
    dashboardSections.find((item) => item.id === activeSection) ?? dashboardSections[0]!;

  return (
    <DashboardFrame
      title={section.title}
      userLabel={authState.user.name}
      activeSection={activeSection}
      onSelectSection={selectSection}
      onSignOut={signOut}
    >
      <DashboardWorkspace section={section} user={authState.user} />
    </DashboardFrame>
  );
}

function DashboardFrame({
  title,
  userLabel,
  activeSection,
  onSelectSection,
  onSignOut,
  children,
}: {
  title: string;
  userLabel?: string;
  activeSection?: DashboardSectionId;
  onSelectSection?: (id: DashboardSectionId) => void;
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
        {activeSection && onSelectSection ? (
          <nav aria-label="Dashboard" className="flex gap-1 overflow-x-auto p-3 md:flex-col">
            {dashboardSections.map(({ id, label, icon: Icon }) => {
              const active = activeSection === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectSection(id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors md:min-w-0',
                    active
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </nav>
        ) : null}
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
  busy,
  onGoogle,
}: {
  error: string | null;
  busy: boolean;
  onGoogle: () => void;
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
            Sign in with Google to open your workspace. Project keys and CI access stay tied to the
            signed-in account.
          </p>
          <div className="mt-7">
            <button
              type="button"
              onClick={onGoogle}
              disabled={busy}
              className={cn(
                buttonVariants({ variant: 'secondary', size: 'lg' }),
                'w-full gap-3 sm:w-auto disabled:pointer-events-none disabled:opacity-60',
              )}
            >
              <GoogleGLogo className="h-5 w-5" />
              {busy ? 'Opening Google...' : 'Continue with Google'}
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

/**
 * Google's official 4-color "G" mark. Inlined so the CSP stays strict and we
 * don't ship a fourth-party asset for a single icon. Colors match Google's
 * brand guidelines (do not restyle).
 */
function GoogleGLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.44a5.51 5.51 0 0 1-2.39 3.62v3h3.86c2.26-2.08 3.58-5.15 3.58-8.73z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.86-3c-1.07.72-2.44 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.3v3.1A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.3a7.21 7.21 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l3.97-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.3 6.6l3.97 3.1C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

function DashboardWorkspace({
  section,
  user,
}: {
  section: DashboardSection;
  user: { name: string; email: string };
}) {
  const Icon = section.icon;
  const accountLabel = user.email || user.name;
  const details = [{ label: 'Account', value: accountLabel }, ...section.details];

  return (
    <main id="main" className="p-6 sm:p-8">
      <section id={section.id} className="border-border border-y py-7">
        <div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="bg-muted grid h-11 w-11 place-items-center rounded-md">
              <Icon className="h-5 w-5" />
            </div>
            <p className="text-2xs text-muted-foreground mt-5 font-mono uppercase tracking-widest">
              Signed in
            </p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight">{section.emptyTitle}</h2>
            <p className="text-muted-foreground mt-3 text-sm leading-6">{section.body}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {section.primaryAction ? <DashboardActionLink action={section.primaryAction} /> : null}
            {section.secondaryAction ? (
              <DashboardActionLink action={section.secondaryAction} fallbackVariant="ghost" />
            ) : null}
          </div>
        </div>
      </section>

      <section className="border-border mt-8 divide-y border-y">
        {details.map((detail) => (
          <div key={detail.label} className="grid gap-2 py-5 sm:grid-cols-[11rem_1fr]">
            <div className="text-2xs text-muted-foreground font-mono uppercase tracking-widest">
              {detail.label}
            </div>
            <div>
              <p className="text-sm leading-6">{detail.value}</p>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

function DashboardActionLink({
  action,
  fallbackVariant = 'secondary',
}: {
  action: DashboardAction;
  fallbackVariant?: NonNullable<DashboardAction['variant']>;
}) {
  return (
    <Link
      href={action.href}
      className={buttonVariants({ variant: action.variant ?? fallbackVariant })}
    >
      {action.label}
    </Link>
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

function isDashboardSectionId(value: string): value is DashboardSectionId {
  return dashboardSections.some((section) => section.id === value);
}

function errorMessage(err: unknown): string {
  if (isFirebaseErrorCode(err, 'auth/unauthorized-domain')) {
    return 'This Vercel domain is not authorized in Firebase yet. Add carbon-web-psi.vercel.app in Firebase Auth > Settings > Authorized domains, then try again.';
  }
  if (isFirebaseErrorCode(err, 'auth/popup-closed-by-user')) {
    return 'Sign-in window closed before the provider finished.';
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Sign in failed. Check that the provider is enabled in Firebase and try again.';
}

function isFirebaseErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === code
  );
}

/**
 * Popup sign-in fails on: third-party cookies blocked (Safari ITP, Brave
 * shields, Chrome incognito), popup blocked, and the "Database is closing"
 * IndexedDB race that Firebase Auth hits when the popup handshake collides
 * with a persistence layer reset. All of those are recoverable via a
 * full-page redirect, which is why we retry on these codes.
 *
 * We do NOT fall back on `auth/unauthorized-domain` or `auth/popup-closed-by-user`
 * — those are user/config errors, not transport failures.
 */
function shouldFallbackToRedirect(err: unknown): boolean {
  if (isFirebaseErrorCode(err, 'auth/popup-blocked')) return true;
  if (isFirebaseErrorCode(err, 'auth/cancelled-popup-request')) return true;
  if (isFirebaseErrorCode(err, 'auth/web-storage-unsupported')) return true;
  if (isFirebaseErrorCode(err, 'auth/internal-error')) return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /database is closing|database is hidden|IndexedDB/i.test(msg);
}
