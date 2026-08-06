import { cn } from '@carbon/ui/cn';

interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  id?: string;
  bordered?: boolean;
}

export function Section({ className, bordered = true, children, ...props }: SectionProps) {
  return (
    <section
      className={cn(
        'relative border-x border-border',
        bordered && 'border-t',
        className,
      )}
      {...props}
    >
      <div className="container">{children}</div>
    </section>
  );
}

interface EyebrowProps {
  children: React.ReactNode;
  className?: string;
}

export function Eyebrow({ children, className }: EyebrowProps) {
  return (
    <p
      className={cn(
        'text-2xs font-medium uppercase tracking-[0.14em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </p>
  );
}

interface SectionHeadingProps {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'left' | 'center';
  className?: string;
}

export function SectionHeading({
  eyebrow,
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
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="max-w-2xl text-3xl font-medium tracking-tight sm:text-4xl">{title}</h2>
      {description ? (
        <p className="max-w-2xl text-base text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
