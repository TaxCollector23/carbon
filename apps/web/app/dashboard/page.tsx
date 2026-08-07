import type { Metadata } from 'next';
import { DashboardRoute } from '@/components/dashboard';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Manage Carbon projects, graphs, snapshots, recordings, and API keys.',
};

export default function DashboardPage() {
  return <DashboardRoute />;
}
