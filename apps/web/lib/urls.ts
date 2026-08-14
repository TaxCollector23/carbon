export const PRODUCTION_SITE_URL = 'https://carbon-web-psi.vercel.app';
export const PRODUCTION_DASHBOARD_URL = 'https://carbon-dashboard-lovat.vercel.app';

export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (raw && raw.trim() !== '') return raw.replace(/\/+$/, '');
  return process.env.NODE_ENV === 'production' ? PRODUCTION_SITE_URL : 'http://localhost:1223';
}

export function dashboardUrl(): string {
  const raw = process.env.NEXT_PUBLIC_DASHBOARD_URL;
  if (raw && raw.trim() !== '') return raw.replace(/\/+$/, '');
  return process.env.NODE_ENV === 'production' ? PRODUCTION_DASHBOARD_URL : 'http://localhost:3001';
}

export function dashboardSignInUrl(next = '/'): string {
  return `${dashboardUrl()}/sign-in?next=${encodeURIComponent(next)}`;
}

export function dashboardSignUpUrl(next = '/'): string {
  return `${dashboardUrl()}/sign-up?next=${encodeURIComponent(next)}`;
}

export function apiUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (raw && raw.trim() !== '') return raw.replace(/\/+$/, '');
  return process.env.NODE_ENV === 'production' ? '' : 'http://localhost:4000';
}
