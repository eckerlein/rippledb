export type ArchitectureItem = {
  title: string;
  description: string;
  href: string;
};

export const ARCHITECTURE_PAGES: ArchitectureItem[] = [
  {
    title: 'Purpose & Scope',
    description: 'What RippleDB is, what it is not, and the deliberate non-goals.',
    href: '/docs/architecture/purpose-scope',
  },
  {
    title: 'Package Structure',
    description: 'Monorepo layering, naming (store-* vs db-*), and dependency graph rules.',
    href: '/docs/architecture/package-structure',
  },
  {
    title: 'Core Principles',
    description: 'Local truth, log-based replication, deterministic conflict resolution, explicit reactivity.',
    href: '/docs/architecture/principles',
  },
  {
    title: 'Core Data Model',
    description: 'Change primitive, HLC, field-level LWW, and tombstones.',
    href: '/docs/architecture/data-model',
  },
  {
    title: 'Sync Model',
    description: 'Append-only history, outbox, cursor pulls, and pull→apply→push.',
    href: '/docs/architecture/sync',
  },
  {
    title: 'Query Model',
    description: 'Row vs list queries, broad invalidation, sorting/filtering semantics.',
    href: '/docs/architecture/queries',
  },
  {
    title: 'Performance',
    description: 'Batch reads per tick/RAF to avoid N+1 without join reactivity.',
    href: '/docs/architecture/performance',
  },
  {
    title: 'UI Integration',
    description: 'DbEvents, list registry, and optional cache invalidation wiring.',
    href: '/docs/architecture/ui-integration',
  },
  {
    title: 'Comparisons & Out-of-Scope',
    description: 'TinyBase comparison and why CRDT/rich-text stays outside core.',
    href: '/docs/architecture/comparisons',
  },
];

