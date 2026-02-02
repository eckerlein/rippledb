import { ARCHITECTURE_PAGES } from "@/lib/architecture";
import { cn } from "@/lib/cn";
import Link from "next/link";

type Props = {
  className?: string;
};

export function ArchitectureBento({ className }: Props) {
  const [first, ...rest] = ARCHITECTURE_PAGES;

  return (
    <div className={cn("space-y-6", className)}>
      {first ? (
        <Link
          href={first.href}
          className={cn(
            "group block rounded-xl border bg-background p-4 transition no-underline",
            "hover:bg-muted/50 hover:border-foreground/20",
          )}
        >
          <div className="text-xs font-mono text-muted-foreground">
            Start here
          </div>
          <div className="mt-1 text-base font-semibold group-hover:underline">
            {first.title}
          </div>
          <div className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {first.description}
          </div>
        </Link>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {rest.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "group block rounded-xl border bg-background p-4 transition no-underline",
              "hover:bg-muted/50 hover:border-foreground/20",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium leading-snug text-foreground/90 group-hover:underline">
                  {item.title}
                </div>
                <div className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  {item.description}
                </div>
              </div>
              <div className="text-muted-foreground transition group-hover:text-foreground/70">
                →
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
