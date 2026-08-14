'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type SearchResult } from '@/lib/api-client';

/**
 * Full-screen command palette bound to Cmd/Ctrl+K.
 *
 * Goals for this iteration:
 *   - Palette, not a dropdown — Cmd+K opens a modal that owns the viewport
 *     so keyboard nav can't be stolen by whatever page the user is on.
 *   - Grouped results (Projects / Events / Snapshots) so the eye can jump
 *     to the right kind before reading text.
 *   - Full keyboard drive: ↑↓ across groups, Enter to open, Cmd+Enter for
 *     new tab, Esc to close.
 *   - Recent searches (last 5) surface when the input is empty so a repeat
 *     lookup is one keystroke away.
 *   - AbortController on every keystroke — a slow query never overwrites
 *     the result set of a newer, faster one.
 */

const RECENTS_KEY = 'carbon.searchRecents';
const MAX_RECENTS = 5;
const DEBOUNCE_MS = 150;

type Group = { kind: SearchResult['kind']; label: string; results: SearchResult[] };

function readRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeRecents(list: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    /* ignore */
  }
}

function groupResults(results: SearchResult[]): Group[] {
  const buckets: Record<SearchResult['kind'], SearchResult[]> = {
    project: [],
    event: [],
    artifact: [],
  };
  for (const r of results) buckets[r.kind].push(r);
  // Fixed display order: Projects first (the most-used lookup), then
  // Events, then Artifacts/Snapshots. Skip empty groups.
  const order: Array<{ kind: SearchResult['kind']; label: string }> = [
    { kind: 'project', label: 'Projects' },
    { kind: 'event', label: 'Events' },
    { kind: 'artifact', label: 'Snapshots' },
  ];
  return order
    .map(({ kind, label }) => ({ kind, label, results: buckets[kind] }))
    .filter((g) => g.results.length > 0);
}

function hrefFor(r: SearchResult): string {
  switch (r.kind) {
    case 'project':
      return `/projects?highlight=${encodeURIComponent(r.id)}`;
    case 'artifact':
      return `/snapshots?highlight=${encodeURIComponent(r.id)}`;
    case 'event':
    default:
      return `/activity?highlight=${encodeURIComponent(r.id)}`;
  }
}

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

export function SearchBar() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const groups = useMemo(() => groupResults(results), [results]);
  // Flat list of results in display order — highlight indexes into this.
  const flat = useMemo(() => groups.flatMap((g) => g.results), [groups]);

  // Cmd+K / Ctrl+K opens; Esc closes. Registered on window so the palette
  // is reachable from any page state (even a focused sub-input).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // On open: hydrate recents, focus input, freeze document scroll.
  useEffect(() => {
    if (!open) return;
    setRecents(readRecents());
    // Defer focus one tick so the input exists in the DOM.
    const handle = requestAnimationFrame(() => inputRef.current?.focus());
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(handle);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Reset transient state when the palette closes so re-opening feels
  // fresh (no stale highlight, no ghost results).
  useEffect(() => {
    if (open) return;
    setQ('');
    setResults([]);
    setError(null);
    setHighlight(0);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  // Debounced search with AbortController. On every keystroke we cancel
  // the pending request and issue a new one — the slowest of two rapid
  // queries will never clobber the freshest results.
  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      api
        .search(trimmed, 'all', { limit: 20, signal: controller.signal })
        .then(({ results: rows }) => {
          if (controller.signal.aborted) return;
          setResults(rows);
          setError(null);
          setHighlight(0);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof Error && err.name === 'AbortError') return;
          setResults([]);
          setError(err instanceof ApiError ? err.message : 'search failed');
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [q, open]);

  const persistRecent = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setRecents((prev) => {
      const next = [trimmed, ...prev.filter((r) => r !== trimmed)].slice(0, MAX_RECENTS);
      writeRecents(next);
      return next;
    });
  }, []);

  const navigate = useCallback(
    (href: string, newTab: boolean) => {
      if (newTab) {
        window.open(href, '_blank', 'noopener');
      } else {
        window.location.assign(href);
      }
      persistRecent(q);
      setOpen(false);
    },
    [persistRecent, q],
  );

  const onInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        if (flat.length === 0) return;
        e.preventDefault();
        setHighlight((h) => (h + 1) % flat.length);
      } else if (e.key === 'ArrowUp') {
        if (flat.length === 0) return;
        e.preventDefault();
        setHighlight((h) => (h - 1 + flat.length) % flat.length);
      } else if (e.key === 'Enter') {
        const target = flat[highlight];
        if (!target) return;
        e.preventDefault();
        navigate(hrefFor(target), e.metaKey || e.ctrlKey);
      }
    },
    [flat, highlight, navigate],
  );

  const modKey = isMac() ? '⌘' : 'Ctrl';

  // The trigger button lives in the topbar; the palette is portaled into
  // the document flow via a fixed overlay below.
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open search"
        data-testid="search-trigger"
        className="border-border bg-background text-muted-foreground hover:bg-muted/40 flex h-8 w-72 items-center gap-2 rounded border px-2 text-sm outline-none"
      >
        <span className="flex-1 text-left">Search…</span>
        <kbd className="border-border text-muted-foreground rounded border px-1.5 py-0.5 text-[10px]">
          {modKey}K
        </kbd>
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search Carbon"
          data-testid="search-modal"
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-24"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="border-border bg-background w-full max-w-2xl overflow-hidden rounded-lg border shadow-2xl">
            <div className="border-border border-b px-4">
              <input
                ref={inputRef}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search projects, events, snapshots…"
                aria-label="Search projects, events, and snapshots"
                data-testid="search-input"
                className="placeholder:text-muted-foreground h-14 w-full bg-transparent text-base outline-none"
              />
            </div>
            <div className="max-h-[60vh] overflow-y-auto" data-testid="search-results">
              {loading && (
                <div
                  className="text-muted-foreground flex items-center gap-2 px-4 py-3 text-xs"
                  data-testid="search-loading"
                >
                  <span
                    aria-hidden="true"
                    className="border-muted-foreground/30 border-t-muted-foreground inline-block h-3 w-3 animate-spin rounded-full border-2"
                  />
                  Searching…
                </div>
              )}
              {!loading && error && (
                <div className="px-4 py-3 text-xs text-red-500" data-testid="search-error">
                  {error}
                </div>
              )}
              {!loading && !error && q.trim() && flat.length === 0 && (
                <div
                  className="text-muted-foreground px-4 py-6 text-center text-sm"
                  data-testid="search-empty"
                >
                  No results for &lsquo;{q.trim()}&rsquo;
                </div>
              )}
              {!q.trim() && recents.length > 0 && (
                <div className="py-2" data-testid="search-recents">
                  <div className="text-muted-foreground px-4 pb-1 pt-1 text-[10px] uppercase tracking-wide">
                    Recent
                  </div>
                  {recents.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => setQ(term)}
                      className="hover:bg-muted/40 block w-full px-4 py-1.5 text-left text-sm"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              )}
              {!q.trim() && recents.length === 0 && (
                <div className="text-muted-foreground px-4 py-6 text-center text-xs">
                  Start typing to search across projects, events, and snapshots.
                </div>
              )}
              {!loading &&
                !error &&
                groups.map((group) => {
                  // Precompute the flat index for each row so highlight
                  // maps back correctly across groups.
                  let cursor = 0;
                  for (const g of groups) {
                    if (g.kind === group.kind) break;
                    cursor += g.results.length;
                  }
                  return (
                    <div
                      key={group.kind}
                      className="py-1"
                      data-testid={`search-group-${group.kind}`}
                    >
                      <div className="text-muted-foreground px-4 pb-1 pt-2 text-[10px] uppercase tracking-wide">
                        {group.label}
                      </div>
                      {group.results.map((r, i) => {
                        const flatIndex = cursor + i;
                        const active = flatIndex === highlight;
                        return (
                          <a
                            key={`${r.kind}:${r.id}`}
                            href={hrefFor(r)}
                            role="option"
                            aria-selected={active}
                            data-testid="search-result"
                            data-active={active ? 'true' : undefined}
                            onMouseEnter={() => setHighlight(flatIndex)}
                            onClick={(e) => {
                              e.preventDefault();
                              navigate(hrefFor(r), e.metaKey || e.ctrlKey);
                            }}
                            className={`block px-4 py-2 text-sm ${
                              active ? 'bg-muted/60' : 'hover:bg-muted/30'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="border-border rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                                {r.kind}
                              </span>
                              <span className="truncate">{r.snippet}</span>
                            </div>
                            <div className="text-muted-foreground mt-0.5 text-[11px]">
                              {new Date(r.createdAt).toLocaleString()}
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
            <div className="border-border text-muted-foreground flex items-center justify-between border-t px-4 py-2 text-[11px]">
              <span>
                <kbd className="border-border rounded border px-1 py-0.5">↑</kbd>{' '}
                <kbd className="border-border rounded border px-1 py-0.5">↓</kbd> navigate
              </span>
              <span>
                <kbd className="border-border rounded border px-1 py-0.5">↵</kbd> open ·{' '}
                <kbd className="border-border rounded border px-1 py-0.5">{modKey}↵</kbd> new tab ·{' '}
                <kbd className="border-border rounded border px-1 py-0.5">Esc</kbd> close
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
