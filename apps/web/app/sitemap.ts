import type { MetadataRoute } from 'next';
import { CATALOG } from '@carbon/catalog';
import { allCompetitorSlugs } from '@/lib/competitors';
import { siteUrl } from '@/lib/urls';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  const vsEntries: MetadataRoute.Sitemap = allCompetitorSlugs().map((slug) => ({
    url: `${base}/vs/${slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/dashboard`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/benchmarks`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/enterprise`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/try`, lastModified: now, changeFrequency: 'weekly', priority: 0.95 },
    ...vsEntries,
    { url: `${base}/emulators`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    ...CATALOG.map((entry) => ({
      url: `${base}/emulators/${entry.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
