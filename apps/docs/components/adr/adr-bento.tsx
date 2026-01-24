import Link from 'next/link';
import { ADRS } from '@/lib/adrs';
import { cn } from '@/lib/cn';

type Props = {
  className?: string;
};

export function AdrBento({ className }: Props) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {ADRS.map((adr, idx) => (
        <Link
          key={adr.id}
          href={adr.href}
          className={cn(
            'group relative rounded-xl border bg-background p-4 transition',
            'hover:bg-muted/50 hover:border-foreground/20',
            idx === 0 && 'sm:col-span-2',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-mono text-muted-foreground">{adr.id}</div>
              <div className="mt-1 text-sm font-semibold leading-snug">{adr.title}</div>
            </div>
            <div className="text-muted-foreground transition group-hover:text-foreground/80">→</div>
          </div>
          <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{adr.description}</div>
        </Link>
      ))}
    </div>
  );
}

