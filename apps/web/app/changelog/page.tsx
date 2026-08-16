import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Download as DownloadIcon } from 'lucide-react';
import { buttonVariants, cn } from '@carbon/ui';
import { Footer } from '@/components/footer';
import { Nav } from '@/components/nav';
import { Section, SectionHeading } from '@/components/section';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Changelog — Carbon',
  description:
    'Release notes for Carbon: the stateful API emulator for development, tests, and CI.',
};

type Release = {
  tag: string;
  name: string;
  publishedAt: string;
  body: string;
  url: string;
};

/**
 * Static fallback so the page always renders even if the GitHub API is
 * unreachable or rate-limited. Mirrors the latest published release notes.
 */
const FALLBACK_RELEASES: Release[] = [
  {
    tag: 'v0.3.0',
    name: 'Self-contained desktop app + headless DMGs',
    publishedAt: '2026-08-16T00:00:00Z',
    url: 'https://github.com/TaxCollector23/carbon/releases/tag/v0.3.0',
    body: `## Desktop app is now self-contained
- The \`carbon\` CLI ships inside the app as a Tauri sidecar — no Node, npm, or separate CLI install.
- Headless \`hdiutil\`-based DMG builder replaces the Finder AppleScript step, so DMGs build on CI.
- Build matrix for macOS arm64/x64, Linux, and Windows.

## Install
- \`curl -fsSL https://carbon-web-psi.vercel.app/install.sh | sh\`
- \`npm i -g carbon-api\`, \`brew install carbon-dev/carbon/carbon\`, or download the desktop app from the releases page.`,
  },
  {
    tag: 'v0.2.1',
    name: 'Signed-installer pipeline scaffolding',
    publishedAt: '2026-08-15T00:00:00Z',
    url: 'https://github.com/TaxCollector23/carbon/releases/tag/v0.2.1',
    body: `## What's in it
- Standalone CLI binaries for macOS arm64/x64, Linux arm64/x64, and Windows x64, plus SHA256SUMS.
- GitHub Release workflow with secret-gated macOS and Windows signing steps.
- Homebrew formula in \`packaging/homebrew/carbon.rb\`.`,
  },
];

async function getReleases(): Promise<Release[]> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/TaxCollector23/carbon/releases?per_page=20',
      {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'carbon-web' },
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = (await res.json()) as Array<{
      tag_name: string;
      name: string | null;
      published_at: string;
      body: string | null;
      html_url: string;
    }>;
    if (!Array.isArray(data) || data.length === 0) return FALLBACK_RELEASES;
    return data.map((r) => ({
      tag: r.tag_name,
      name: r.name ?? r.tag_name,
      publishedAt: r.published_at,
      body: r.body ?? '',
      url: r.html_url,
    }));
  } catch {
    return FALLBACK_RELEASES;
  }
}

/** Escape HTML, then apply a small allow-list of markdown transforms. */
function renderInline(text: string): React.ReactNode[] {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts: React.ReactNode[] = [];
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const codeRe = /`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  const combined = new RegExp(
    `\\[([^\\]]+)\\]\\((https?://[^)\\s]+)\\)|\\\`([^\\\`]+)\\\`|\\*\\*([^*]+)\\*\\*`,
    'g',
  );
  while ((match = combined.exec(escaped)) !== null) {
    if (match.index > last) {
      parts.push(escaped.slice(last, match.index));
    }
    if (match[1] && match[2]) {
      parts.push(
        <a
          key={key++}
          href={match[2]}
          target="_blank"
          rel="noreferrer"
          className="decoration-muted-foreground/50 underline underline-offset-4"
        >
          {match[1]}
        </a>,
      );
    } else if (match[3]) {
      parts.push(
        <code key={key++} className="font-mono text-[0.9em]">
          {match[3]}
        </code>,
      );
    } else if (match[4]) {
      parts.push(<strong key={key++}>{match[4]}</strong>);
    }
    last = match.index + match[0].length;
  }
  if (last < escaped.length) parts.push(escaped.slice(last));
  return parts;
}

function renderMarkdown(body: string): React.ReactNode {
  const lines = body.split('\n');
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={`ul-${key++}`} className="mt-3 list-disc space-y-1.5 pl-5">
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (/^#{1,4}\s/.test(trimmed)) {
      flushBullets();
      const text = trimmed.replace(/^#{1,4}\s/, '');
      out.push(
        <h3 key={`h-${key++}`} className="mt-6 text-lg font-semibold tracking-tight first:mt-0">
          {renderInline(text)}
        </h3>,
      );
    } else if (/^[-*]\s/.test(trimmed)) {
      bullets.push(trimmed.replace(/^[-*]\s/, ''));
    } else if (trimmed === '') {
      flushBullets();
    } else {
      flushBullets();
      out.push(
        <p key={`p-${key++}`} className="text-muted-foreground mt-3 leading-6 first:mt-0">
          {renderInline(trimmed)}
        </p>,
      );
    }
  }
  flushBullets();
  return out;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default async function ChangelogPage() {
  const releases = await getReleases();

  return (
    <div className="bg-background text-foreground min-h-dvh">
      <Nav />
      <main id="main" className="pt-16">
        <Section id="changelog" className="pb-10 pt-20 md:pb-14 md:pt-28">
          <div className="mx-auto max-w-4xl">
            <div className="text-muted-foreground font-mono text-xs uppercase tracking-[0.22em]">
              release notes
            </div>
            <h1 className="mt-5 text-balance text-4xl font-medium tracking-tight sm:text-5xl">
              Changelog
            </h1>
            <p className="text-muted-foreground mt-4 max-w-2xl text-pretty text-lg leading-8">
              Every release of the Carbon CLI, desktop app, and clients — straight from the GitHub
              releases feed.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="https://github.com/TaxCollector23/carbon/releases"
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ size: 'lg' }), 'gap-2')}
              >
                All releases on GitHub
                <ArrowUpRight className="h-4 w-4" />
              </a>
              <Link
                href="/#download"
                className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'gap-2')}
              >
                <DownloadIcon className="h-4 w-4" />
                Get Carbon
              </Link>
            </div>
          </div>
        </Section>

        <Section bordered={false} className="pt-0">
          <div className="mx-auto max-w-4xl">
            <ol className="border-border relative space-y-12 border-l pl-8">
              {releases.map((release, i) => (
                <li key={release.tag} className="relative">
                  <span className="border-border bg-background absolute -left-[37px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full border">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        i === 0 ? 'bg-primary' : 'bg-muted-foreground/50',
                      )}
                    />
                  </span>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h2 className="text-xl font-semibold tracking-tight">
                      {release.name}
                      <span className="text-muted-foreground ml-3 font-mono text-sm font-normal">
                        {release.tag}
                      </span>
                    </h2>
                    <span className="text-muted-foreground text-sm">
                      {formatDate(release.publishedAt)}
                    </span>
                  </div>
                  <div className="mt-3 text-sm">{renderMarkdown(release.body)}</div>
                  <a
                    href={release.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground mt-4 inline-flex items-center gap-1 text-xs font-medium"
                  >
                    View release on GitHub
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </Section>
      </main>
      <Footer />
    </div>
  );
}
