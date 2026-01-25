import type { ConvergeSchema, EntityName } from '@converge/core';
import type {
  CustomMaterializerConfig,
  MaterializerExecutor,
  TagsRow,
} from '@converge/materialize-db';
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

type DrizzleMaterializerConfigOptions<
  S extends ConvergeSchema,
  TTable extends DrizzleTable,
  TDb,
  TConfig extends DrizzleTableConfig,
> = {
  /**
   * Map entity names to their Drizzle table definitions.
   * These tables must already exist in your database.
   */
  tableMap: Record<EntityName<S>, TTable>;

  /**
   * Drizzle database/transaction instance used to execute queries.
   */
  db: TDb;

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
 * import { createDrizzleMaterializerConfig } from '@converge/materialize-drizzle';
 * import { sqliteTable, text, integer, getTableConfig } from 'drizzle-orm/sqlite-core';
 *
 * const todosTable = sqliteTable('todos', {
 *   id: text('id').primaryKey(),
 *   title: text('title'),
 *   done: integer('done'),
 * });
 *
 * const tagsTable = sqliteTable('converge_tags', {
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
 *   materializer: createDrizzleMaterializerConfig({
 *     tableMap: { todos: todosTable },
 *     tagsTableDef: tagsTable,
 *     getTableConfig,
 *   }),
 * });
 * ```
 */
export function createDrizzleMaterializerConfig<
  S extends ConvergeSchema,
  TTable extends DrizzleTable = DrizzleTable,
  TDb = unknown,
  TConfig extends DrizzleTableConfig = DrizzleTableConfig,
>(options: DrizzleMaterializerConfigOptions<S, TTable, TDb, TConfig>): CustomMaterializerConfig<S> {
  const {
    tableMap,
    fieldMap,
    tagsTableDef,
    db,
    ensureTagsTable,
    getTableConfig,
    normalizeValue,
  } = options;

  // Extract table names from Drizzle table definitions and create reverse lookup
  const extractedTableMap: Record<EntityName<S>, string> = {} as Record<EntityName<S>, string>;
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

  for (const [entity, table] of Object.entries(tableMap)) {
    const config = getTableConfig(table);
    const tableName = config.name;
    extractedTableMap[entity as EntityName<S>] = tableName;
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

  return {
    tableMap: extractedTableMap,
    fieldMap: fieldMap as Partial<Record<EntityName<S>, Record<string, string>>> | undefined,
    executor,
  };
}
