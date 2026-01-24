import Link from 'next/link';
import { ADRS } from '@/lib/adrs';
import { cn } from '@/lib/cn';

type Props = {
  className?: string;
};

const CATEGORY_ORDER: Array<(typeof ADRS)[number]['category']> = [
  'Core Principles',
  'Sync & Conflicts',
  'Query Model',
  'Performance',
  'Integration & Product',
  'Scope & Process',
];

function groupByCategory() {
  const groups = new Map<(typeof ADRS)[number]['category'], typeof ADRS>();
  for (const cat of CATEGORY_ORDER) groups.set(cat, []);
  for (const adr of ADRS) groups.get(adr.category)?.push(adr);
  return groups;
}

export function AdrBento({ className }: Props) {
  const groups = groupByCategory();

  return (
    <div className={cn('space-y-8', className)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={ADRS[0]?.href ?? '/docs/adr'}
          className={cn(
            'group rounded-xl border bg-background p-4 transition no-underline',
            'hover:bg-muted/50 hover:border-foreground/20',
          )}
        >
          <div className="text-xs font-mono text-muted-foreground">Start here</div>
          <div className="mt-1 text-base font-semibold group-hover:underline">{ADRS[0]?.title}</div>
          <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{ADRS[0]?.description}</div>
        </Link>

        <div className="rounded-xl border bg-background p-4">
          <div className="text-xs font-mono text-muted-foreground">How to use ADRs</div>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            <li>
              <span className="text-foreground/80">Read in order</span> (0001 → 0013) to build the mental model.
            </li>
            <li>
              If you contradict an ADR, <span className="text-foreground/80">write a new ADR</span> explaining why.
            </li>
            <li>Prefer <span className="text-foreground/80">small ADRs</span> over huge ones.</li>
          </ul>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {CATEGORY_ORDER.map((category) => {
          const items = groups.get(category) ?? [];
          if (items.length === 0) return null;

          return (
            <section key={category} className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{category}</h3>
                <div className="text-xs text-muted-foreground">{items.length} ADRs</div>
              </div>

              <div className="divide-y rounded-xl border bg-background">
                {items.map((adr) => (
                  <Link
                    key={adr.id}
                    href={adr.href}
                    className={cn(
                      'group block p-4 transition no-underline',
                      'hover:bg-muted/50',
                      'first:rounded-t-xl last:rounded-b-xl',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-muted-foreground">{adr.id}</div>
                        <div className="mt-1 text-sm font-medium leading-snug text-foreground/90 group-hover:underline">
                          {adr.title}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground leading-relaxed">{adr.description}</div>
                      </div>
                      <div className="text-muted-foreground transition group-hover:text-foreground/70">→</div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

