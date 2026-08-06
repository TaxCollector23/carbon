import { ArrowUpRight } from 'lucide-react';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@carbon/ui';
import { Topbar } from '@/components/topbar';

const stats = [
  { label: 'Projects', value: '3' },
  { label: 'Requests today', value: '12,481' },
  { label: 'Avg p95', value: '38ms' },
  { label: 'Snapshots', value: '17' },
];

const projects = [
  { name: 'Stripe replica', endpoints: 142, snapshots: 6, status: 'healthy' },
  { name: 'Internal billing', endpoints: 38, snapshots: 4, status: 'healthy' },
  { name: 'Twilio replica', endpoints: 21, snapshots: 7, status: 'stale' },
];

export default function DashboardHome() {
  return (
    <>
      <Topbar title="Overview" />
      <div className="p-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardHeader>
                <CardDescription>{stat.label}</CardDescription>
                <CardTitle className="text-2xl">{stat.value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-medium">Projects</h2>
            <button className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
              View all
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Endpoints</th>
                    <th className="px-6 py-3 font-medium">Snapshots</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project, i) => (
                    <tr key={project.name} className={i < projects.length - 1 ? 'border-b border-border' : ''}>
                      <td className="px-6 py-4 font-medium">{project.name}</td>
                      <td className="px-6 py-4 text-muted-foreground">{project.endpoints}</td>
                      <td className="px-6 py-4 text-muted-foreground">{project.snapshots}</td>
                      <td className="px-6 py-4">
                        <Badge variant={project.status === 'healthy' ? 'subtle' : 'outline'}>
                          {project.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}
