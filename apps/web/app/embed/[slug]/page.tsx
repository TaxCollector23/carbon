import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { galleryEntries } from '../../gallery/page';
import { apiUrl } from '@/lib/urls';

interface EmbedParams {
  readonly slug: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<EmbedParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entry = galleryEntries.find((e) => e.slug === slug);
  if (!entry) return { title: 'Embed' };
  return {
    title: `${entry.name} · Live Carbon embed`,
    description: `Interactive read-only Carbon replica for ${entry.name}.`,
  };
}

/**
 * Live embeddable replica page. Server-renders a minimal HTML shell that,
 * on load, boots a short-lived read replica via packages/sdk's `emulate()`
 * against the curated spec — but we do that from a browser bundle. Because
 * the SDK depends on Node built-ins, the page instead uses a lightweight
 * fetch proxy: it calls the public control-plane's `/v1/embed/:slug/state`
 * endpoint (a future addition) and renders an iframe pointing at the live
 * replica URL that endpoint returns.
 *
 * Kept intentionally minimal so it can be embedded via <iframe> without
 * bringing in the marketing chrome.
 */
export default async function EmbedPage({ params }: { params: Promise<EmbedParams> }) {
  const { slug } = await params;
  const entry = galleryEntries.find((e) => e.slug === slug);
  if (!entry) notFound();
  const runInCarbonUrl = `/gallery`;
  return (
    <div
      style={{
        fontFamily: 'var(--font-sans, system-ui)',
        background: '#0a0a0a',
        color: '#fafafa',
        minHeight: '100dvh',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #1f1f1f',
          fontSize: 13,
        }}
      >
        <span>
          <strong>Carbon</strong> · live replica · {entry.name}
        </span>
        <a
          href={runInCarbonUrl}
          style={{
            color: '#fafafa',
            border: '1px solid #333',
            padding: '6px 10px',
            borderRadius: 6,
            textDecoration: 'none',
          }}
        >
          Run in Carbon
        </a>
      </header>
      <main style={{ padding: 16 }}>
        <div style={{ marginBottom: 12, color: '#a1a1a1', fontSize: 13 }}>
          Requests to this replica are stateful and read-only for external viewers. Source spec:{' '}
          <code style={{ color: '#eaeaea' }}>{entry.specUrl}</code>
        </div>
        <iframe
          title={`Carbon live replica — ${entry.name}`}
          src={`${apiUrl()}/v1/embed/${entry.slug}/state`}
          style={{
            width: '100%',
            height: 'calc(100dvh - 140px)',
            border: '1px solid #1f1f1f',
            borderRadius: 8,
            background: '#050505',
          }}
        />
      </main>
    </div>
  );
}
