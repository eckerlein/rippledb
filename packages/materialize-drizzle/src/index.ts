import type { ConvergeSchema, EntityName } from '@converge/core';
import type {
  CustomMaterializerConfig,
  MaterializerExecutor,
  TagsRow,
} from '@converge/materialize-db';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { and, eq } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { pgTable, text as pgText, integer as pgInteger } from 'drizzle-orm/pg-core';

type DrizzleTable = SQLiteTable | PgTable;

type DrizzleDb = {
  select: () => {
    from: (table: DrizzleTable) => {
      where: (...args: unknown[]) => {
        limit: (limit: number) => {
          all?: () => unknown[];
          get?: () => unknown;
          execute?: () => Promise<unknown[]>;
        };
      };
    };
  };
  insert: (table: DrizzleTable) => {
    values: (values: Record<string, unknown>) => {
      onConflictDoUpdate: (options: unknown) => {
        run?: () => unknown;
        execute?: () => Promise<unknown>;
      };
    };
  };
};

type DrizzleMaterializerConfigOptions<S extends ConvergeSchema> = {
  /**
   * Map entity names to their Drizzle table definitions.
   * These tables must already exist in your database.
   */
  tableMap: Record<EntityName<S>, DrizzleTable>;

  /**
   * Drizzle database/transaction instance used to execute queries.
   */
  db: DrizzleDb;

  /**
   * Optional field mapping from schema field names to database column names.
   * If omitted, field names are used as column names.
   */
  fieldMap?: Partial<Record<EntityName<S>, Record<string, string>>>;

  /**
   * Custom tags table name. Default: 'converge_tags'
   */
  tagsTable?: string;

  /**
   * Optional hook to ensure tags table exists (migrations).
   */
  ensureTagsTable?: () => Promise<void> | void;
};

/**
 * Creates a materializer configuration for Drizzle ORM.
 *
 * Uses Drizzle's query builder to generate database-agnostic SQL commands,
 * allowing you to use Drizzle table definitions with the materialization system
 * without writing SQL.
 *
 * @example
 * ```ts
 * import { createDrizzleMaterializerConfig } from '@converge/materialize-drizzle';
 * import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
 *
 * const todosTable = sqliteTable('todos', {
 *   id: text('id').primaryKey(),
 *   title: text('title'),
 *   done: integer('done'),
 * });
 *
 * const db = new SqliteDb({
 *   filename: 'db.sqlite',
 *   materializer: createDrizzleMaterializerConfig({
 *     tableMap: { todos: todosTable },
 *   }),
 * });
 * ```
 */
export function createDrizzleMaterializerConfig<S extends ConvergeSchema>(
  options: DrizzleMaterializerConfigOptions<S>,
): Omit<CustomMaterializerConfig<S>, 'db'> {
  const { tableMap, fieldMap, tagsTable = 'converge_tags', db, ensureTagsTable } = options;

  // Helper to get table config and dialect without SQL
  const getTableConfigUnified = (table: DrizzleTable) => {
    try {
      return { config: getSqliteTableConfig(table as SQLiteTable), dialect: 'sqlite' as const };
    } catch {
      return { config: getPgTableConfig(table as PgTable), dialect: 'postgresql' as const };
    }
  };

  // Infer dialect from first table
  const firstTable = Object.values(tableMap)[0];
  if (!firstTable) {
    throw new Error('tableMap must contain at least one table');
  }
  const { dialect } = getTableConfigUnified(firstTable);

  // Create tags table definition (no raw SQL)
  const tagsTableDef =
    dialect === 'sqlite'
      ? sqliteTable(tagsTable, {
          entity: text('entity').notNull(),
          id: text('id').notNull(),
          data: text('data').notNull(),
          tags: text('tags').notNull(),
          deleted: integer('deleted').notNull().default(0),
          deleted_tag: text('deleted_tag'),
        })
      : pgTable(tagsTable, {
          entity: pgText('entity').notNull(),
          id: pgText('id').notNull(),
          data: pgText('data').notNull(),
          tags: pgText('tags').notNull(),
          deleted: pgInteger('deleted').notNull().default(0),
          deleted_tag: pgText('deleted_tag'),
        });

  // Extract table names from Drizzle table definitions and create reverse lookup
  const extractedTableMap: Record<EntityName<S>, string> = {} as Record<EntityName<S>, string>;
  const tableNameToDrizzleTable = new Map<string, DrizzleTable>();

  for (const [entity, table] of Object.entries(tableMap)) {
    const { config } = getTableConfigUnified(table);
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

  const getColumnKeyByName = (
    tableConfig: ReturnType<typeof getTableConfigUnified>['config'],
    name: string,
  ) => {
    for (const [key, column] of Object.entries(tableConfig.columns)) {
      if (column.name === name) return key;
    }
    return null;
  };

  const executor: MaterializerExecutor = {
    ensureTagsTable: async () => {
      if (ensureTagsTable) await ensureTagsTable();
    },
    async loadTags(entity: string, id: string): Promise<TagsRow | null> {
      const rows = await loadRows(
        db
          .select()
          .from(tagsTableDef)
          .where(and(eq(tagsTableDef.entity, entity), eq(tagsTableDef.id, id)))
          .limit(1),
      );
      return (rows[0] as TagsRow | undefined) ?? null;
    },
    async saveTags(entity: string, id: string, dataJson: string, tagsJson: string): Promise<void> {
      await runWrite(
        db
          .insert(tagsTableDef)
          .values({
            entity,
            id,
            data: dataJson,
            tags: tagsJson,
            deleted: 0,
            deleted_tag: null,
          })
          .onConflictDoUpdate({
            target: [tagsTableDef.entity, tagsTableDef.id],
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
        db
          .insert(tagsTableDef)
          .values({
            entity,
            id,
            data: dataJson,
            tags: tagsJson,
            deleted: 1,
            deleted_tag: deletedTag,
          })
          .onConflictDoUpdate({
            target: [tagsTableDef.entity, tagsTableDef.id],
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

      const tableConfig = getTableConfigUnified(drizzleTable).config;
      const idKey = getColumnKeyByName(tableConfig, 'id');
      if (!idKey) {
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
        insertValues[key] = values[i];
        const updateMatch = updates[i]?.match(/^(\w+)\s*=/);
        if (updateMatch) {
          updateSet[key] = values[i];
        }
      }

      await runWrite(
        db
          .insert(drizzleTable)
          .values(insertValues)
          .onConflictDoUpdate({
            target: [tableConfig.columns[idKey as keyof typeof tableConfig.columns]],
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
