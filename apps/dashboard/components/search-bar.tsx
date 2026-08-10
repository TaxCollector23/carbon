'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type SearchResult } from '@/lib/api-client';

/**
 * Top-nav search bar backed by `/v1/search`. Cmd+K (Ctrl+K on non-mac)
 * focuses the input from anywhere on the page; results appear inline as
 * the user types with a small debounce so we don't hammer the API on
 * every keystroke.
 *
 * The dropdown is intentionally minimal — the goal is discoverability
 * (find that snapshot from three weeks ago) rather than a full-blown
 * command palette. Rendering + navigation stay in vanilla React so this
 * component can drop into the topbar without pulling in a new dep.
 */
export function SearchBar() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cmd+K / Ctrl+K focuses the input from anywhere on the page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      } else if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click-outside closes the dropdown.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  // Debounced search — 200ms is enough to swallow rapid typing without
  // feeling laggy on a slow query.
  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const { results: rows } = await api.search(q.trim(), 'all', { limit: 15 });
        if (!cancelled) {
          setResults(rows);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setResults([]);
          setError(err instanceof ApiError ? err.message : 'search failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q]);

  const onFocus = useCallback(() => setOpen(true), []);

  return (
    <div ref={containerRef} className="relative w-72">
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={onFocus}
        placeholder="Search…  (Cmd+K)"
        aria-label="Search events, projects, and artifacts"
        className="border-border bg-background focus:ring-primary/40 h-8 w-full rounded border px-2 text-sm outline-none focus:ring-2"
      />
      {open && (q || loading || error) && (
        <div
          role="listbox"
          className="border-border bg-background absolute right-0 top-9 z-50 max-h-96 w-96 overflow-y-auto rounded border shadow-lg"
        >
          {loading && (
            <div className="text-muted-foreground px-3 py-2 text-xs">Searching…</div>
          )}
          {error && !loading && (
            <div className="px-3 py-2 text-xs text-red-500">{error}</div>
          )}
          {!loading && !error && results.length === 0 && q && (
            <div className="text-muted-foreground px-3 py-2 text-xs">No matches for “{q}”</div>
          )}
          {results.map((r) => (
            <a
              key={`${r.kind}:${r.id}`}
              href={hrefFor(r)}
              className="hover:bg-muted/40 block border-b border-border/60 px-3 py-2 text-sm last:border-0"
              role="option"
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
          ))}
        </div>
      )}
    </div>
  );
}

function hrefFor(r: SearchResult): string {
  switch (r.kind) {
    case 'project':
      return `/projects/${encodeURIComponent(r.id)}`;
    case 'artifact':
      return `/artifacts/${encodeURIComponent(r.id)}`;
    case 'event':
    default:
      return `/events?highlight=${encodeURIComponent(r.id)}`;
  }
}
