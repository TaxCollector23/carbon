import { cn } from '@carbon/ui/cn';

interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  id?: string;
  bordered?: boolean;
}

export function Section({ className, bordered = true, children, ...props }: SectionProps) {
  return (
    <section
      className={cn(
        'border-border relative scroll-mt-20 border-x',
        bordered && 'border-t',
        className,
      )}
      {...props}
    >
      <div className="container">{children}</div>
    </section>
  );
}

interface SectionHeadingProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'left' | 'center';
  className?: string;
}

export function SectionHeading({
  title,
  description,
  align = 'left',
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        align === 'center' && 'items-center text-center',
        className,
      )}
    >
      <h2 className="max-w-2xl text-3xl font-medium tracking-tight sm:text-4xl">{title}</h2>
      {description ? (
        <p className="text-muted-foreground max-w-2xl text-base">{description}</p>
      ) : null}
    </div>
  );
}
