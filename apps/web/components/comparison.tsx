import { Check, Minus, X } from 'lucide-react';
import { Section, SectionHeading } from './section';
import { cn } from '@carbon/ui/cn';

type Cell = boolean | 'partial';

interface Row {
  label: string;
  carbon: Cell;
  mocks: Cell;
  staging: Cell;
  postman: Cell;
}

const rows: Row[] = [
  { label: 'Stateful responses', carbon: true, mocks: false, staging: true, postman: 'partial' },
  { label: 'Works offline', carbon: true, mocks: true, staging: false, postman: false },
  { label: 'Deterministic replay', carbon: true, mocks: 'partial', staging: false, postman: false },
  { label: 'Understands relationships', carbon: true, mocks: false, staging: true, postman: false },
  { label: 'Webhook simulation', carbon: true, mocks: false, staging: true, postman: false },
  { label: 'Snapshot / rollback', carbon: true, mocks: false, staging: false, postman: false },
  { label: 'Zero rate limits', carbon: true, mocks: true, staging: false, postman: true },
  { label: 'No shared blast radius', carbon: true, mocks: true, staging: false, postman: true },
];

function Marker({ value }: { value: Cell }) {
  if (value === true) return <Check className="text-foreground h-4 w-4" aria-label="Yes" />;
  if (value === 'partial')
    return <Minus className="text-muted-foreground h-4 w-4" aria-label="Partial" />;
  return <X className="text-muted-foreground/40 h-4 w-4" aria-label="No" />;
}

export function Comparison() {
  return (
    <Section id="comparison">
      <SectionHeading title="What each option gives you." />
      <div className="border-border mt-12 overflow-x-auto border-y">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left">
              <th className="px-6 py-4 font-medium">Capability</th>
              <th className="text-foreground px-4 py-4 text-center font-medium">Carbon</th>
              <th className="px-4 py-4 text-center font-medium">Mock libs</th>
              <th className="px-4 py-4 text-center font-medium">Shared staging</th>
              <th className="px-4 py-4 text-center font-medium">Postman / Insomnia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.label}
                className={cn(
                  'border-border border-b last:border-b-0',
                  i % 2 === 1 && 'bg-subtle/50',
                )}
              >
                <td className="px-6 py-3.5">{row.label}</td>
                <td className="px-4 py-3.5">
                  <div className="flex justify-center">
                    <Marker value={row.carbon} />
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex justify-center">
                    <Marker value={row.mocks} />
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex justify-center">
                    <Marker value={row.staging} />
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex justify-center">
                    <Marker value={row.postman} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
