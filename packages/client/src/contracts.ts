export type DbEventKind = 'insert' | 'update' | 'delete';

export type DbEvent<
  S extends import('@rippledb/core').RippleSchema = import('@rippledb/core').RippleSchema,
  E extends import('@rippledb/core').EntityName<S> = import('@rippledb/core').EntityName<S>,
> = {
  entity: E;
  kind: DbEventKind;
  id?: string;
};

/**
 * Client-side local truth store contract (the DB the UI reads from).
 * Implementations live in `@rippledb/store-*`.
 */
export interface Store<
  S extends import('@rippledb/core').RippleSchema = import('@rippledb/core').RippleSchema,
  ListQuery = unknown,
> {
  /**
   * Apply a batch of already-validated changes transactionally.
   */
  applyChanges(changes: import('@rippledb/core').Change<S>[]): Promise<void>;

  /**
   * Fetch a single row by primary key (precise invalidation target).
   */
  getRow<E extends import('@rippledb/core').EntityName<S>>(entity: E, id: string): Promise<S[E] | null>;

  /**
   * Run an arbitrary list query (broad invalidation target).
   * The shape is store-specific (SQL string, prepared stmt, query DSL, etc.).
   */
  listRows(query: ListQuery): Promise<Array<S[import('@rippledb/core').EntityName<S>]>>;

  /**
   * Subscribe to post-commit DbEvents emitted by the write path.
   * Used by bindings (e.g. TanStack Query invalidation).
   */
  onEvent?(cb: (event: DbEvent<S>) => void): () => void;
}

