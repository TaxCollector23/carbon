import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:1223';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl.replace(/\/$/, '');
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/dashboard`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/benchmarks`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
