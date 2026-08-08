/**
 * "Run in Carbon" README badge.
 *
 * Rendered as inline SVG so it embeds losslessly in dark and light READMEs,
 * respects the container width, and never requires a shields.io round-trip.
 * The label text and color are query-string driven so downstream teams can
 * theme it to match their brand:
 *   /embed/badge.svg              → default black on white "Run in Carbon"
 *   /embed/badge.svg?label=Try+It → custom right-hand label
 *   /embed/badge.svg?color=orange → custom accent
 */
export const dynamic = 'force-static';

const SAFE = /^[A-Za-z0-9 _-]{1,32}$/;

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const label = readSafeParam(url, 'label') ?? 'Run in Carbon';
  const color = readColorParam(url, 'color') ?? '#0a0a0a';
  const leftLabel = 'Carbon';
  const leftWidth = 62;
  const rightWidth = Math.max(72, label.length * 7 + 20);
  const totalWidth = leftWidth + rightWidth;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${escapeXml(leftLabel)}: ${escapeXml(label)}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".2"/>
    <stop offset="1" stop-opacity=".2"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="20" fill="#222"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${leftWidth / 2}" y="15">${escapeXml(leftLabel)}</text>
    <text x="${leftWidth + rightWidth / 2}" y="15">${escapeXml(label)}</text>
  </g>
</svg>`;

  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      // Static badges are safe to cache aggressively.
      'cache-control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}

function readSafeParam(url: URL, key: string): string | null {
  const raw = url.searchParams.get(key);
  if (!raw || !SAFE.test(raw)) return null;
  return raw;
}

function readColorParam(url: URL, key: string): string | null {
  const raw = url.searchParams.get(key);
  if (!raw) return null;
  if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) return raw;
  if (/^[a-zA-Z]{3,16}$/.test(raw)) return raw;
  return null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
