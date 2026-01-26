import type { RippleSchema, EntityName } from '@rippledb/core';
import type {
  CustomMaterializerConfig,
  MaterializerConfigBase,
  MaterializerExecutor,
  SyncMaterializerExecutor,
  TagsRow,
} from '@rippledb/materialize-db';
import { and, eq } from 'drizzle-orm';

type DrizzleTable = object;

type DrizzleColumn = {
  name: string;
};

type DrizzleTableConfig = {
  name: string;
  columns: Record<string, DrizzleColumn> | DrizzleColumn[];
};

type BivariantCallback<Args extends unknown[], Result> = {
  bivarianceHack: (...args: Args) => Result;
}['bivarianceHack'];

type DrizzleMaterializerOptions<
  S extends RippleSchema,
  TTable extends DrizzleTable,
  TConfig extends DrizzleTableConfig,
> = {
  /**
   * Map entity names to their Drizzle table definitions.
   * These tables must already exist in your database.
   */
  tableMap: Record<EntityName<S>, TTable>;

  /**
   * Tags table definition (required to avoid dialect-specific branching).
   */
  tagsTableDef: TTable;

  /**
   * Provide table config extraction (dialect-specific in userland).
   */
  getTableConfig: BivariantCallback<[TTable], TConfig>;

  /**
   * Optional field mapping from schema field names to database column names.
   * If omitted, field names are used as column names.
   */
  fieldMap?: Partial<Record<EntityName<S>, Record<string, string>>>;

  /**
   * Optional value normalizer before writing to the database.
   * Useful for SQLite boolean -> integer conversions.
   */
  normalizeValue?: (value: unknown, context: { tableName: string; columnName: string }) => unknown;

  /**
   * Optional hook to ensure tags table exists (migrations).
   */
  ensureTagsTable?: () => Promise<void> | void;
};

/**
 * Creates a materializer configuration for Drizzle ORM.
 *
 * Uses Drizzle's query builder to execute database-agnostic queries,
 * allowing you to use Drizzle table definitions with the materialization system
 * without writing SQL.
 *
 * @example
 * ```ts
 * import { createDrizzleMaterializerConfig } from '@rippledb/materialize-drizzle';
 * import { sqliteTable, text, integer, getTableConfig } from 'drizzle-orm/sqlite-core';
 * import { drizzle } from 'drizzle-orm/better-sqlite3';
 *
 * const todosTable = sqliteTable('todos', {
 *   id: text('id').primaryKey(),
 *   title: text('title'),
 *   done: integer('done'),
 * });
 *
 * const tagsTable = sqliteTable('ripple_tags', {
 *   entity: text('entity').notNull(),
 *   id: text('id').notNull(),
 *   data: text('data').notNull(),
 *   tags: text('tags').notNull(),
 *   deleted: integer('deleted').notNull().default(0),
 *   deleted_tag: text('deleted_tag'),
 * });
 *
 * const db = new SqliteDb({
 *   filename: 'db.sqlite',
 *   materializer: ({ db }) => {
 *     const drizzleDb = drizzle(db);
 *     return createDrizzleMaterializerConfig(drizzleDb, {
 *       tableMap: { todos: todosTable },
 *       tagsTableDef: tagsTable,
 *       getTableConfig,
 *     });
 *   },
 * });
 * ```
 */
export function createDrizzleMaterializerExecutor<
  S extends RippleSchema,
  TTable extends DrizzleTable = DrizzleTable,
  TDb = unknown,
  TConfig extends DrizzleTableConfig = DrizzleTableConfig,
>(db: TDb, options: DrizzleMaterializerOptions<S, TTable, TConfig>): MaterializerExecutor {
  const {
    tableMap,
    tagsTableDef,
    ensureTagsTable,
    getTableConfig,
    normalizeValue,
  } = options;

  // Extract table names from Drizzle table definitions and create reverse lookup
  const tableNameToDrizzleTable = new Map<string, TTable>();

  type SelectChain = {
    from: (table: TTable) => {
      where: (...args: unknown[]) => {
        limit: (limit: number) => unknown;
      };
    };
  };

  type InsertChain = {
    values: (values: Record<string, unknown>) => {
      onConflictDoUpdate: (options: unknown) => {
        run?: () => unknown;
        execute?: () => Promise<unknown>;
      };
    };
  };

  const dbClient = db as {
    select: () => unknown;
    insert: (table: TTable) => unknown;
  };

  for (const [, table] of Object.entries(tableMap)) {
    const config = getTableConfig(table);
    const tableName = config.name;
    tableNameToDrizzleTable.set(tableName, table);
  }

  const runWrite = async (query: unknown): Promise<void> => {
    const candidate = query as { run?: () => unknown; execute?: () => Promise<unknown> };
    if (candidate.run) {
      candidate.run();
      return;
    }
    if (candidate.execute) {
      await candidate.execute();
      return;
    }
    await Promise.resolve(query);
  };

  const loadRows = async (query: unknown): Promise<unknown[]> => {
    const candidate = query as {
      all?: () => unknown[];
      get?: () => unknown;
      execute?: () => Promise<unknown[]>;
    };
    if (candidate.all) return candidate.all();
    if (candidate.get) {
      const row = candidate.get();
      return row ? [row] : [];
    }
    if (candidate.execute) return await candidate.execute();
    return [];
  };

  const getColumnKeyByName = (tableConfig: DrizzleTableConfig, name: string) => {
    if (Array.isArray(tableConfig.columns)) {
      const column = tableConfig.columns.find((col) => col.name === name);
      return column ? column.name : null;
    }
    for (const [key, column] of Object.entries(tableConfig.columns)) {
      if (column.name === name) return key;
    }
    return null;
  };

  const getColumnByName = (tableConfig: DrizzleTableConfig, name: string): DrizzleColumn | null => {
    if (Array.isArray(tableConfig.columns)) {
      return tableConfig.columns.find((col) => col.name === name) ?? null;
    }
    for (const column of Object.values(tableConfig.columns)) {
      if (column.name === name) return column;
    }
    return null;
  };

  const executor: MaterializerExecutor = {
    ensureTagsTable: async () => {
      if (ensureTagsTable) await ensureTagsTable();
    },
    async loadTags(entity: string, id: string): Promise<TagsRow | null> {
      const entityColumn = (tagsTableDef as Record<string, unknown>).entity;
      const idColumn = (tagsTableDef as Record<string, unknown>).id;
      const rows = await loadRows(
        (dbClient.select() as SelectChain)
          .from(tagsTableDef)
          .where(and(eq(entityColumn as never, entity), eq(idColumn as never, id)))
          .limit(1),
      );
      return (rows[0] as TagsRow | undefined) ?? null;
    },
    async saveTags(entity: string, id: string, dataJson: string, tagsJson: string): Promise<void> {
      await runWrite(
        (dbClient.insert(tagsTableDef) as InsertChain).values({
            entity,
            id,
            data: dataJson,
            tags: tagsJson,
            deleted: 0,
            deleted_tag: null,
          })
          .onConflictDoUpdate({
            target: [
              (tagsTableDef as Record<string, unknown>).entity,
              (tagsTableDef as Record<string, unknown>).id,
            ],
            set: {
              data: dataJson,
              tags: tagsJson,
              deleted: 0,
              deleted_tag: null,
            },
          }),
      );
    },
    async removeTags(
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
      deletedTag: string,
    ): Promise<void> {
      await runWrite(
        (dbClient.insert(tagsTableDef) as InsertChain).values({
            entity,
            id,
            data: dataJson,
            tags: tagsJson,
            deleted: 1,
            deleted_tag: deletedTag,
          })
          .onConflictDoUpdate({
            target: [
              (tagsTableDef as Record<string, unknown>).entity,
              (tagsTableDef as Record<string, unknown>).id,
            ],
            set: {
              data: dataJson,
              tags: tagsJson,
              deleted: 1,
              deleted_tag: deletedTag,
            },
          }),
      );
    },
    async saveEntity(
      tableName: string,
      id: string,
      columns: string[],
      values: unknown[],
      updates: string[],
    ): Promise<void> {
      const drizzleTable = tableNameToDrizzleTable.get(tableName);
      if (!drizzleTable) {
        throw new Error(`No Drizzle table found for table name: ${tableName}`);
      }

      const tableConfig = getTableConfig(drizzleTable);
      const idKey = getColumnKeyByName(tableConfig, 'id');
      const idColumn = getColumnByName(tableConfig, 'id');
      if (!idKey || !idColumn) {
        throw new Error(`No id column found in Drizzle table ${tableName}`);
      }

      const insertValues: Record<string, unknown> = { [idKey]: id };
      const updateSet: Record<string, unknown> = {};

      for (let i = 0; i < columns.length; i++) {
        const columnName = columns[i];
        const key = getColumnKeyByName(tableConfig, columnName);
        if (!key) {
          throw new Error(`Column ${columnName} not found in Drizzle table ${tableName}`);
        }
        const normalizedValue = normalizeValue
          ? normalizeValue(values[i], { tableName, columnName })
          : values[i];
        insertValues[key] = normalizedValue;
        const updateMatch = updates[i]?.match(/^(\w+)\s*=/);
        if (updateMatch) {
          updateSet[key] = normalizedValue;
        }
      }

      await runWrite(
        (dbClient.insert(drizzleTable) as InsertChain).values(insertValues).onConflictDoUpdate({
          target: [idColumn],
          set: updateSet,
        }),
      );
    },
  };

  return executor;
}

export function createDrizzleMaterializerConfig<
  S extends RippleSchema,
  TTable extends DrizzleTable = DrizzleTable,
  TDb = unknown,
  TConfig extends DrizzleTableConfig = DrizzleTableConfig,
>(
  db: TDb,
  options: DrizzleMaterializerOptions<S, TTable, TConfig>,
): CustomMaterializerConfig<S> {
  const extractedTableMap: Record<EntityName<S>, string> = {} as Record<EntityName<S>, string>;

  for (const [entity, table] of Object.entries(options.tableMap)) {
    const config = options.getTableConfig(table);
    extractedTableMap[entity as EntityName<S>] = config.name;
  }

  return {
    tableMap: extractedTableMap,
    fieldMap: options.fieldMap as Partial<Record<EntityName<S>, Record<string, string>>> | undefined,
    executor: createDrizzleMaterializerExecutor(db, options),
  };
}

/**
 * Creates a SYNC materializer executor for Drizzle ORM with better-sqlite3.
 * Use this with db-sqlite which requires synchronous operations.
 */
export function createDrizzleSyncMaterializerExecutor<
  S extends RippleSchema,
  TTable extends DrizzleTable = DrizzleTable,
  TDb = unknown,
  TConfig extends DrizzleTableConfig = DrizzleTableConfig,
>(db: TDb, options: DrizzleMaterializerOptions<S, TTable, TConfig>): SyncMaterializerExecutor {
  const {
    tableMap,
    tagsTableDef,
    ensureTagsTable,
    getTableConfig,
    normalizeValue,
  } = options;

  const tableNameToDrizzleTable = new Map<string, TTable>();

  type SelectChain = {
    from: (table: TTable) => {
      where: (...args: unknown[]) => {
        limit: (limit: number) => { all: () => unknown[] };
      };
    };
  };

  type InsertChain = {
    values: (values: Record<string, unknown>) => {
      onConflictDoUpdate: (options: unknown) => { run: () => void };
    };
  };

  const dbClient = db as {
    select: () => unknown;
    insert: (table: TTable) => unknown;
  };

  for (const [, table] of Object.entries(tableMap)) {
    const config = getTableConfig(table);
    tableNameToDrizzleTable.set(config.name, table);
  }

  const getColumnKeyByName = (tableConfig: DrizzleTableConfig, name: string) => {
    if (Array.isArray(tableConfig.columns)) {
      const column = tableConfig.columns.find((col) => col.name === name);
      return column ? column.name : null;
    }
    for (const [key, column] of Object.entries(tableConfig.columns)) {
      if (column.name === name) return key;
    }
    return null;
  };

  const getColumnByName = (tableConfig: DrizzleTableConfig, name: string): DrizzleColumn | null => {
    if (Array.isArray(tableConfig.columns)) {
      return tableConfig.columns.find((col) => col.name === name) ?? null;
    }
    for (const column of Object.values(tableConfig.columns)) {
      if (column.name === name) return column;
    }
    return null;
  };

  const executor: SyncMaterializerExecutor = {
    ensureTagsTable: () => {
      if (ensureTagsTable) ensureTagsTable();
    },
    loadTags(entity: string, id: string): TagsRow | null {
      const entityColumn = (tagsTableDef as Record<string, unknown>).entity;
      const idColumn = (tagsTableDef as Record<string, unknown>).id;
      const rows = (dbClient.select() as SelectChain)
        .from(tagsTableDef)
        .where(and(eq(entityColumn as never, entity), eq(idColumn as never, id)))
        .limit(1)
        .all();
      return (rows[0] as TagsRow | undefined) ?? null;
    },
    saveTags(entity: string, id: string, dataJson: string, tagsJson: string): void {
      (dbClient.insert(tagsTableDef) as InsertChain)
        .values({
          entity,
          id,
          data: dataJson,
          tags: tagsJson,
          deleted: 0,
          deleted_tag: null,
        })
        .onConflictDoUpdate({
          target: [
            (tagsTableDef as Record<string, unknown>).entity,
            (tagsTableDef as Record<string, unknown>).id,
          ],
          set: {
            data: dataJson,
            tags: tagsJson,
            deleted: 0,
            deleted_tag: null,
          },
        })
        .run();
    },
    removeTags(
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
      deletedTag: string,
    ): void {
      (dbClient.insert(tagsTableDef) as InsertChain)
        .values({
          entity,
          id,
          data: dataJson,
          tags: tagsJson,
          deleted: 1,
          deleted_tag: deletedTag,
        })
        .onConflictDoUpdate({
          target: [
            (tagsTableDef as Record<string, unknown>).entity,
            (tagsTableDef as Record<string, unknown>).id,
          ],
          set: {
            data: dataJson,
            tags: tagsJson,
            deleted: 1,
            deleted_tag: deletedTag,
          },
        })
        .run();
    },
    saveEntity(
      tableName: string,
      id: string,
      columns: string[],
      values: unknown[],
      updates: string[],
    ): void {
      const drizzleTable = tableNameToDrizzleTable.get(tableName);
      if (!drizzleTable) {
        throw new Error(`No Drizzle table found for table name: ${tableName}`);
      }

      const tableConfig = getTableConfig(drizzleTable);
      const idKey = getColumnKeyByName(tableConfig, 'id');
      const idColumn = getColumnByName(tableConfig, 'id');
      if (!idKey || !idColumn) {
        throw new Error(`No id column found in Drizzle table ${tableName}`);
      }

      const insertValues: Record<string, unknown> = { [idKey]: id };
      const updateSet: Record<string, unknown> = {};

      for (let i = 0; i < columns.length; i++) {
        const columnName = columns[i];
        const key = getColumnKeyByName(tableConfig, columnName);
        if (!key) {
          throw new Error(`Column ${columnName} not found in Drizzle table ${tableName}`);
        }
        const normalizedValue = normalizeValue
          ? normalizeValue(values[i], { tableName, columnName })
          : values[i];
        insertValues[key] = normalizedValue;
        const updateMatch = updates[i]?.match(/^(\w+)\s*=/);
        if (updateMatch) {
          updateSet[key] = normalizedValue;
        }
      }

      (dbClient.insert(drizzleTable) as InsertChain)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [idColumn],
          set: updateSet,
        })
        .run();
    },
  };

  return executor;
}

/**
 * Creates a SYNC materializer config for Drizzle ORM with better-sqlite3.
 * Use this with db-sqlite which requires synchronous operations.
 */
export function createDrizzleSyncMaterializerConfig<
  S extends RippleSchema,
  TTable extends DrizzleTable = DrizzleTable,
  TDb = unknown,
  TConfig extends DrizzleTableConfig = DrizzleTableConfig,
>(
  db: TDb,
  options: DrizzleMaterializerOptions<S, TTable, TConfig>,
): MaterializerConfigBase<S> & { executor: SyncMaterializerExecutor } {
  const extractedTableMap: Record<EntityName<S>, string> = {} as Record<EntityName<S>, string>;

  for (const [entity, table] of Object.entries(options.tableMap)) {
    const config = options.getTableConfig(table);
    extractedTableMap[entity as EntityName<S>] = config.name;
  }

  return {
    tableMap: extractedTableMap,
    fieldMap: options.fieldMap as Partial<Record<EntityName<S>, Record<string, string>>> | undefined,
    executor: createDrizzleSyncMaterializerExecutor(db, options),
  };
}
