'use client';

import { useRef, useState } from 'react';

interface ImportResult {
  irId: string;
  endpoints: number;
  resources: number;
}

/**
 * Client-side upload widget for Postman collections. Reads a local file,
 * parses the JSON in the browser, and POSTs it as the request body to
 * `/v1/ingest/postman?projectSlug=<slug>`.
 */
export function ImportPostmanButton({
  projectSlug,
  apiBase = process.env.NEXT_PUBLIC_CARBON_API_BASE ?? 'http://localhost:4000',
}: {
  projectSlug: string;
  apiBase?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'uploading'; name: string }
    | { kind: 'ok'; result: ImportResult }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function onFile(file: File) {
    setStatus({ kind: 'uploading', name: file.name });
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch(
        `${apiBase}/v1/ingest/postman?projectSlug=${encodeURIComponent(projectSlug)}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body.slice(0, 200)}`);
      }
      const result = (await res.json()) as ImportResult;
      setStatus({ kind: 'ok', result });
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="border-border hover:bg-muted rounded-md border px-3 py-1.5 text-sm"
      >
        Import Postman collection
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
      {status.kind === 'uploading' && (
        <p className="text-muted-foreground text-xs">Uploading {status.name}…</p>
      )}
      {status.kind === 'ok' && (
        <p className="text-xs text-green-600">
          Imported {status.result.endpoints} endpoints, {status.result.resources} resources.
        </p>
      )}
      {status.kind === 'error' && (
        <p className="text-xs text-red-600">Failed: {status.message}</p>
      )}
    </div>
  );
}
