import type { Change, RippleSchema } from '@rippledb/core';
import type {
  AppendRequest,
  AppendResult,
  Cursor,
  Db,
  PullRequest,
  PullResponse,
} from '@rippledb/server';
import { applyChangeToState } from '@rippledb/materialize-core';
import { and, eq, gt, asc } from 'drizzle-orm';

// ============================================================================
// Types
// ============================================================================

/**
 * Generic Drizzle table type.
 */
type DrizzleTable = object;

/**
 * Column with a name property.
 */
type DrizzleColumn = {
  name: string;
};

/**
 * Table configuration extracted from Drizzle.
 */
type DrizzleTableConfig = {
  name: string;
  columns: Record<string, DrizzleColumn> | DrizzleColumn[];
};

/**
 * Bivariant callback helper for getTableConfig.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GetTableConfigFn = (table: any) => DrizzleTableConfig;

/**
 * Tags row structure for materialization.
 */
export type TagsRow = {
  id: string;
  data: string;
  tags: string;
  deleted: number;
  deleted_tag: string | null;
};

/**
 * Materializer executor interface for the DrizzleDb adapter.
 * Functions can return sync or Promise depending on the database driver.
 */
export type DrizzleMaterializerExecutor<TDb> = {
  loadTags(db: TDb, entity: string, id: string): TagsRow | null | Promise<TagsRow | null>;
  saveTags(db: TDb, entity: string, id: string, data: unknown, tags: string[]): void | Promise<void>;
  removeTags(db: TDb, entity: string, id: string, deletedTag: string): void | Promise<void>;
  saveEntity?(db: TDb, entity: string, id: string, values: Record<string, unknown>): void | Promise<void>;
  removeEntity?(db: TDb, entity: string, id: string): void | Promise<void>;
};

/**
 * Materializer config returned from the factory.
 */
export type DrizzleMaterializerConfig<S extends RippleSchema, TDb> = {
  tableMap: Partial<Record<keyof S, string>>;
  fieldMap?: Partial<Record<keyof S, Record<string, string>>>;
  executor: DrizzleMaterializerExecutor<TDb>;
};

/**
 * Required columns for the changes table.
 */
export type ChangesTableColumns<TTable extends DrizzleTable> = TTable & {
  seq: DrizzleColumn;
  stream: DrizzleColumn;
  change_json: DrizzleColumn;
};

/**
 * Required columns for the idempotency table.
 */
export type IdempotencyTableColumns<TTable extends DrizzleTable> = TTable & {
  stream: DrizzleColumn;
  idempotency_key: DrizzleColumn;
  last_seq: DrizzleColumn;
};

export type DrizzleDbOptions<
  S extends RippleSchema = RippleSchema,
  TDb = unknown,
  TTable extends DrizzleTable = DrizzleTable,
> = {
  /**
   * Drizzle database instance.
   * Works with any Drizzle-supported database (SQLite, PostgreSQL, MySQL, etc.)
   */
  db: TDb;

  /**
   * Drizzle table definition for the changes table.
   * Must have columns: seq (auto-increment primary key), stream (text), change_json (text)
   *
   * @example SQLite
   * ```ts
   * const changesTable = sqliteTable('ripple_changes', {
   *   seq: integer('seq').primaryKey({ autoIncrement: true }),
   *   stream: text('stream').notNull(),
   *   change_json: text('change_json').notNull(),
   * });
   * ```
   *
   * @example PostgreSQL
   * ```ts
   * const changesTable = pgTable('ripple_changes', {
   *   seq: serial('seq').primaryKey(),
   *   stream: text('stream').notNull(),
   *   change_json: text('change_json').notNull(),
   * });
   * ```
   */
  changesTable: ChangesTableColumns<TTable>;

  /**
   * Drizzle table definition for the idempotency table.
   * Must have columns: stream (text), idempotency_key (text), last_seq (integer)
   * Primary key: (stream, idempotency_key)
   */
  idempotencyTable: IdempotencyTableColumns<TTable>;

  /**
   * Function to extract table configuration from a Drizzle table.
   * Import from your dialect: `import { getTableConfig } from 'drizzle-orm/sqlite-core'`
   */
  getTableConfig: GetTableConfigFn;

  /**
   * Materializer factory function (optional).
   * The db passed to this function is the transaction-bound instance.
   */
  materializer?: (ctx: { db: TDb }) => DrizzleMaterializerConfig<S, TDb>;

  /**
   * Set to true for synchronous drivers like better-sqlite3.
   * When true, transactions run synchronously and all queries use .run()/.all()/.get().
   * When false (default), transactions are async and queries use .execute().
   */
  isSync?: boolean;
};

// ============================================================================
// Internal types for Drizzle query builder
// ============================================================================

type SelectChain<TTable> = {
  from: (table: TTable) => {
    where: (...args: unknown[]) => {
      orderBy: (...args: unknown[]) => {
        limit: (limit: number) => QueryResult;
      };
      limit: (limit: number) => QueryResult;
    };
  };
};

type InsertChain = {
  values: (values: Record<string, unknown>) => QueryResult & {
    returning: (columns?: Record<string, unknown>) => QueryResult;
    onConflictDoNothing: () => QueryResult;
    onConflictDoUpdate: (options: unknown) => QueryResult;
  };
};

type UpdateChain = {
  set: (values: Record<string, unknown>) => {
    where: (...args: unknown[]) => QueryResult;
  };
};

type QueryResult = {
  // Sync methods (better-sqlite3)
  run?: () => unknown;
  all?: () => unknown[];
  get?: () => unknown;
  // Async methods (pg, mysql, etc.)
  execute?: () => Promise<unknown>;
};

type DrizzleClient<TTable> = {
  select: () => SelectChain<TTable>;
  insert: (table: TTable) => InsertChain;
  update: (table: TTable) => UpdateChain;
  transaction: <T>(fn: (tx: DrizzleClient<TTable>) => T | Promise<T>) => T | Promise<T>;
};

// ============================================================================
// Helper functions
// ============================================================================

function encodeCursor(seq: number): Cursor {
  return String(seq);
}

function decodeCursor(cursor: Cursor | null): number {
  if (!cursor) return 0;
  const n = Number(cursor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

// ============================================================================
// Sync helpers (for better-sqlite3 and similar)
// ============================================================================

/**
 * Execute a write query synchronously.
 */
function runWriteSync(query: QueryResult): void {
  if (query.run) {
    query.run();
  }
}

/**
 * Execute a read query synchronously and return rows.
 */
function loadRowsSync(query: QueryResult): unknown[] {
  if (query.all) return query.all();
  if (query.get) {
    const row = query.get();
    return row ? [row] : [];
  }
  return [];
}

/**
 * Execute an insert synchronously and return the first row (for RETURNING).
 */
function runInsertReturningSync(query: QueryResult): unknown | null {
  if (query.all) {
    const rows = query.all();
    return rows[0] ?? null;
  }
  if (query.get) {
    return query.get() ?? null;
  }
  return null;
}

// ============================================================================
// Async helpers (for pg, mysql, etc.)
// ============================================================================

/**
 * Execute a write query asynchronously.
 */
async function runWrite(query: QueryResult): Promise<void> {
  if (query.run) {
    query.run();
    return;
  }
  if (query.execute) {
    await query.execute();
    return;
  }
  await Promise.resolve(query);
}

/**
 * Execute a read query asynchronously and return rows.
 */
async function loadRows(query: QueryResult): Promise<unknown[]> {
  if (query.all) return query.all();
  if (query.get) {
    const row = query.get();
    return row ? [row] : [];
  }
  if (query.execute) {
    const result = await query.execute();
    return Array.isArray(result) ? result : [];
  }
  return [];
}

/**
 * Execute an insert asynchronously and return the first row (for RETURNING).
 */
async function runInsertReturning(query: QueryResult): Promise<unknown | null> {
  if (query.all) {
    const rows = query.all();
    return rows[0] ?? null;
  }
  if (query.get) {
    return query.get() ?? null;
  }
  if (query.execute) {
    const result = await query.execute();
    return Array.isArray(result) ? result[0] ?? null : null;
  }
  return null;
}

// ============================================================================
// DrizzleDb class
// ============================================================================

/**
 * DrizzleDb - A fully database-agnostic adapter using Drizzle ORM.
 *
 * Works with any Drizzle-supported database by using Drizzle's query builder,
 * which automatically generates the correct SQL for each dialect.
 *
 * @example SQLite with better-sqlite3
 * ```ts
 * import Database from 'better-sqlite3';
 * import { drizzle } from 'drizzle-orm/better-sqlite3';
 * import { sqliteTable, text, integer, getTableConfig } from 'drizzle-orm/sqlite-core';
 *
 * const changesTable = sqliteTable('ripple_changes', {
 *   seq: integer('seq').primaryKey({ autoIncrement: true }),
 *   stream: text('stream').notNull(),
 *   change_json: text('change_json').notNull(),
 * });
 *
 * const idempotencyTable = sqliteTable('ripple_idempotency', {
 *   stream: text('stream').notNull(),
 *   idempotency_key: text('idempotency_key').notNull(),
 *   last_seq: integer('last_seq').notNull(),
 * }, (t) => [primaryKey({ columns: [t.stream, t.idempotency_key] })]);
 *
 * const sqlite = new Database('db.sqlite');
 * const db = drizzle(sqlite);
 *
 * const rippleDb = new DrizzleDb({
 *   db,
 *   changesTable,
 *   idempotencyTable,
 *   getTableConfig,
 * });
 * ```
 *
 * @example PostgreSQL
 * ```ts
 * import { drizzle } from 'drizzle-orm/node-postgres';
 * import { pgTable, text, serial, integer, primaryKey, getTableConfig } from 'drizzle-orm/pg-core';
 *
 * const changesTable = pgTable('ripple_changes', {
 *   seq: serial('seq').primaryKey(),
 *   stream: text('stream').notNull(),
 *   change_json: text('change_json').notNull(),
 * });
 *
 * const idempotencyTable = pgTable('ripple_idempotency', {
 *   stream: text('stream').notNull(),
 *   idempotency_key: text('idempotency_key').notNull(),
 *   last_seq: integer('last_seq').notNull(),
 * }, (t) => [primaryKey({ columns: [t.stream, t.idempotency_key] })]);
 *
 * const rippleDb = new DrizzleDb({
 *   db: drizzle(pool),
 *   changesTable,
 *   idempotencyTable,
 *   getTableConfig,
 * });
 * ```
 */
export class DrizzleDb<
  S extends RippleSchema = RippleSchema,
  TDb = unknown,
  TTable extends DrizzleTable = DrizzleTable,
> implements Db<S>
{
  private db: TDb;
  private changesTable: ChangesTableColumns<TTable>;
  private idempotencyTable: IdempotencyTableColumns<TTable>;
  private materializerFactory: DrizzleDbOptions<S, TDb, TTable>['materializer'];
  private isSync: boolean;

  constructor(opts: DrizzleDbOptions<S, TDb, TTable>) {
    this.db = opts.db;
    this.changesTable = opts.changesTable;
    this.idempotencyTable = opts.idempotencyTable;
    this.materializerFactory = opts.materializer;
    this.isSync = opts.isSync ?? false;
  }

  async append(req: AppendRequest<S>): Promise<AppendResult> {
    if (this.isSync) {
      return this.appendSync(req);
    }
    return this.appendAsync(req);
  }

  private appendSync(req: AppendRequest<S>): AppendResult {
    const dbClient = this.db as unknown as DrizzleClient<TTable>;

    // Run everything in a synchronous transaction for atomicity
    const result = dbClient.transaction((tx) => {
      // Check idempotency if provided
      if (req.idempotencyKey) {
        const existingRows = loadRowsSync(
          tx
            .select()
            .from(this.idempotencyTable as TTable)
            .where(
              and(
                eq(this.idempotencyTable.stream as never, req.stream),
                eq(this.idempotencyTable.idempotency_key as never, req.idempotencyKey),
              ),
            )
            .limit(1),
        );

        if (existingRows.length > 0) {
          return { accepted: 0 };
        }

        runWriteSync(
          tx.insert(this.idempotencyTable as TTable).values({
            stream: req.stream,
            idempotency_key: req.idempotencyKey,
            last_seq: 0,
          } as Record<string, unknown>),
        );
      }

      // Insert changes and track the last sequence number
      let lastSeq = 0;
      for (const change of req.changes) {
        const inserted = runInsertReturningSync(
          tx
            .insert(this.changesTable as TTable)
            .values({
              stream: req.stream,
              change_json: JSON.stringify(change),
            } as Record<string, unknown>)
            .returning({ seq: this.changesTable.seq } as Record<string, unknown>),
        );
        if (inserted && typeof (inserted as Record<string, unknown>).seq === 'number') {
          lastSeq = (inserted as Record<string, unknown>).seq as number;
        }
      }

      // Update idempotency with the last sequence
      if (req.idempotencyKey) {
        runWriteSync(
          tx
            .update(this.idempotencyTable as TTable)
            .set({ last_seq: lastSeq } as Record<string, unknown>)
            .where(
              and(
                eq(this.idempotencyTable.stream as never, req.stream),
                eq(this.idempotencyTable.idempotency_key as never, req.idempotencyKey),
              ),
            ),
        );
      }

      // Materialize changes if configured
      if (this.materializerFactory) {
        const config = this.materializerFactory({ db: tx as unknown as TDb });

        for (const change of req.changes) {
          const tagsRow = config.executor.loadTags(
            tx as unknown as TDb,
            change.entity as string,
            change.entityId,
          ) as TagsRow | null;
          const current = tagsRow
            ? {
                values: JSON.parse(tagsRow.data),
                tags: JSON.parse(tagsRow.tags),
                deleted: tagsRow.deleted === 1,
                deletedTag: tagsRow.deleted_tag,
              }
            : null;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const applyResult = applyChangeToState(current as any, change);

          if (applyResult.changed) {
            if (applyResult.deleted) {
              config.executor.removeTags(
                tx as unknown as TDb,
                change.entity as string,
                change.entityId,
                applyResult.state.deletedTag ?? '',
              );
              if (config.executor.removeEntity) {
                config.executor.removeEntity(
                  tx as unknown as TDb,
                  change.entity as string,
                  change.entityId,
                );
              }
            } else {
              config.executor.saveTags(
                tx as unknown as TDb,
                change.entity as string,
                change.entityId,
                applyResult.state.values,
                Object.values(applyResult.state.tags) as string[],
              );
              if (config.executor.saveEntity && config.fieldMap?.[change.entity]) {
                config.executor.saveEntity(
                  tx as unknown as TDb,
                  change.entity as string,
                  change.entityId,
                  applyResult.state.values as Record<string, unknown>,
                );
              }
            }
          }
        }
      }

      return { accepted: req.changes.length };
    });

    return result as AppendResult;
  }

  private async appendAsync(req: AppendRequest<S>): Promise<AppendResult> {
    const dbClient = this.db as unknown as DrizzleClient<TTable>;

    // Run everything in an async transaction for atomicity
    const result = await dbClient.transaction(async (tx) => {
      // Check idempotency if provided
      if (req.idempotencyKey) {
        const existingRows = await loadRows(
          tx
            .select()
            .from(this.idempotencyTable as TTable)
            .where(
              and(
                eq(this.idempotencyTable.stream as never, req.stream),
                eq(this.idempotencyTable.idempotency_key as never, req.idempotencyKey),
              ),
            )
            .limit(1),
        );

        if (existingRows.length > 0) {
          return { accepted: 0 };
        }

        await runWrite(
          tx.insert(this.idempotencyTable as TTable).values({
            stream: req.stream,
            idempotency_key: req.idempotencyKey,
            last_seq: 0,
          } as Record<string, unknown>),
        );
      }

      // Insert changes and track the last sequence number
      let lastSeq = 0;
      for (const change of req.changes) {
        const inserted = await runInsertReturning(
          tx
            .insert(this.changesTable as TTable)
            .values({
              stream: req.stream,
              change_json: JSON.stringify(change),
            } as Record<string, unknown>)
            .returning({ seq: this.changesTable.seq } as Record<string, unknown>),
        );
        if (inserted && typeof (inserted as Record<string, unknown>).seq === 'number') {
          lastSeq = (inserted as Record<string, unknown>).seq as number;
        }
      }

      // Update idempotency with the last sequence
      if (req.idempotencyKey) {
        await runWrite(
          tx
            .update(this.idempotencyTable as TTable)
            .set({ last_seq: lastSeq } as Record<string, unknown>)
            .where(
              and(
                eq(this.idempotencyTable.stream as never, req.stream),
                eq(this.idempotencyTable.idempotency_key as never, req.idempotencyKey),
              ),
            ),
        );
      }

      // Materialize changes if configured
      if (this.materializerFactory) {
        const config = this.materializerFactory({ db: tx as unknown as TDb });

        for (const change of req.changes) {
          const tagsRow = await config.executor.loadTags(
            tx as unknown as TDb,
            change.entity as string,
            change.entityId,
          );
          const current = tagsRow
            ? {
                values: JSON.parse(tagsRow.data),
                tags: JSON.parse(tagsRow.tags),
                deleted: tagsRow.deleted === 1,
                deletedTag: tagsRow.deleted_tag,
              }
            : null;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const applyResult = applyChangeToState(current as any, change);

          if (applyResult.changed) {
            if (applyResult.deleted) {
              await config.executor.removeTags(
                tx as unknown as TDb,
                change.entity as string,
                change.entityId,
                applyResult.state.deletedTag ?? '',
              );
              if (config.executor.removeEntity) {
                await config.executor.removeEntity(
                  tx as unknown as TDb,
                  change.entity as string,
                  change.entityId,
                );
              }
            } else {
              await config.executor.saveTags(
                tx as unknown as TDb,
                change.entity as string,
                change.entityId,
                applyResult.state.values,
                Object.values(applyResult.state.tags) as string[],
              );
              if (config.executor.saveEntity && config.fieldMap?.[change.entity]) {
                await config.executor.saveEntity(
                  tx as unknown as TDb,
                  change.entity as string,
                  change.entityId,
                  applyResult.state.values as Record<string, unknown>,
                );
              }
            }
          }
        }
      }

      return { accepted: req.changes.length };
    });

    return result as AppendResult;
  }

  async pull(req: PullRequest): Promise<PullResponse<S>> {
    const afterSeq = decodeCursor(req.cursor);
    const limit = req.limit ?? 500;

    const dbClient = this.db as unknown as DrizzleClient<TTable>;

    const query = dbClient
      .select()
      .from(this.changesTable as TTable)
      .where(
        and(
          eq(this.changesTable.stream as never, req.stream),
          gt(this.changesTable.seq as never, afterSeq),
        ),
      )
      .orderBy(asc(this.changesTable.seq as never))
      .limit(limit);

    const rows = this.isSync ? loadRowsSync(query) : await loadRows(query);

    type ChangeRow = { seq: number; change_json: string };
    const changes = rows.map((row) => JSON.parse((row as ChangeRow).change_json) as Change<S>);
    const last = rows[rows.length - 1] as ChangeRow | undefined;

    return {
      changes,
      nextCursor: last ? encodeCursor(last.seq) : req.cursor,
    };
  }

  /**
   * Close is a no-op for DrizzleDb.
   * The user manages the underlying database connection.
   */
  close(): void {
    // User manages the underlying connection
  }
}
