export type AdrSummary = {
  id: string;
  title: string;
  description: string;
  href: string;
};

export const ADRS: AdrSummary[] = [
  {
    id: 'ADR-0001',
    title: 'Local Storage Is the Source of Truth',
    description: 'Durable local storage is canonical; UI state is derived from it.',
    href: '/docs/adr/0001-local-storage-source-of-truth',
  },
  {
    id: 'ADR-0002',
    title: 'Replication Is Log-Based (Append-Only)',
    description: 'Replicas sync via an append-only change log (cursor pull + outbox push).',
    href: '/docs/adr/0002-log-based-replication',
  },
  {
    id: 'ADR-0003',
    title: 'Field-Level LWW Using Hybrid Logical Clocks (HLC)',
    description: 'Conflicts resolve per-field by HLC tags, not per-row.',
    href: '/docs/adr/0003-field-level-lww-hlc',
  },
  {
    id: 'ADR-0004',
    title: 'Deletes Are Modeled as Tombstones',
    description: 'Deletes participate in LWW to prevent resurrection.',
    href: '/docs/adr/0004-tombstone-deletes',
  },
  {
    id: 'ADR-0005',
    title: 'Distinguish Row Queries from List Queries',
    description: 'Row and list queries have different invalidation semantics.',
    href: '/docs/adr/0005-row-vs-list-queries',
  },
  {
    id: 'ADR-0006',
    title: 'Row Queries Are Invalidated Precisely by ID',
    description: 'Updates invalidate ["entity", id]; deletes invalidate and remove cached rows.',
    href: '/docs/adr/0006-row-invalidation-by-id',
  },
  {
    id: 'ADR-0007',
    title: 'List Queries Use Broad Invalidation and Rerun',
    description: 'Correctness over precision: rerun lists rather than attempt query introspection.',
    href: '/docs/adr/0007-list-queries-broad-invalidation',
  },
  {
    id: 'ADR-0008',
    title: 'Sorting Uses the Same Invalidation Strategy as Filtering',
    description: 'Sorting can reorder entire lists, so it triggers full reruns like filtering.',
    href: '/docs/adr/0008-sorting-invalidation-like-filtering',
  },
  {
    id: 'ADR-0009',
    title: 'Performance via Batched Reads (Not Join Reactivity)',
    description: 'Solve N+1 by batching reads per tick rather than reactive joins.',
    href: '/docs/adr/0009-batched-reads-not-reactive-joins',
  },
  {
    id: 'ADR-0010',
    title: 'UI Cache Integration Is Optional and Decoupled',
    description: 'Core emits neutral DbEvents; UI integrations are opt-in adapters.',
    href: '/docs/adr/0010-ui-cache-integration-optional',
  },
  {
    id: 'ADR-0011',
    title: 'List Query Dependency Mapping Is Explicit (Registry-Based)',
    description: 'Optional registry maps list key prefixes to dependent entities for invalidation.',
    href: '/docs/adr/0011-list-dependency-registry',
  },
  {
    id: 'ADR-0012',
    title: 'CRDTs Are Explicitly Out of Core Scope',
    description: 'CRDT semantics aren’t part of core; integrate separately if needed later.',
    href: '/docs/adr/0012-crdts-out-of-scope',
  },
  {
    id: 'ADR-0013',
    title: 'Predictability Over Complexity',
    description: 'Prefer simple rerun-based correctness; defer optimizations until proven necessary.',
    href: '/docs/adr/0013-simplicity-over-complexity',
  },
];

