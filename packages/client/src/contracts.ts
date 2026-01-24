export type DbEventKind = 'insert' | 'update' | 'delete';

export type DbEvent = {
  entity: string;
  kind: DbEventKind;
  id?: string;
};

/**
 * Client-side local truth store contract (the DB the UI reads from).
 * Implementations live in `@converge/store-*`.
 */
export interface Store<Row = unknown, ListQuery = unknown> {
  /**
   * Apply a batch of already-validated changes transactionally.
   */
  applyChanges(changes: import('@converge/core').Change[]): Promise<void>;

  /**
   * Fetch a single row by primary key (precise invalidation target).
   */
  getRow(entity: string, id: string): Promise<Row | null>;

  /**
   * Run an arbitrary list query (broad invalidation target).
   * The shape is store-specific (SQL string, prepared stmt, query DSL, etc.).
   */
  listRows(query: ListQuery): Promise<Row[]>;

  /**
   * Subscribe to post-commit DbEvents emitted by the write path.
   * Used by bindings (e.g. TanStack Query invalidation).
   */
  onEvent?(cb: (event: DbEvent) => void): () => void;
}

