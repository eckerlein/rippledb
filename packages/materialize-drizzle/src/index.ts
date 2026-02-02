import type {
  RippleSchema,
  EntityName,
  SchemaDescriptor,
  InferSchema,
  ChangeTags,
  Hlc,
} from '@rippledb/core';
import type { MaterializerAdapter, MaterializerState } from '@rippledb/materialize-core';
import { and, eq } from 'drizzle-orm';

type DrizzleTable = object;

type DrizzleColumn = {
  name: string;
};

type DrizzleTableConfig = {
  name: string;
  columns: Record<string, DrizzleColumn> | DrizzleColumn[];
};

type TagsRow = {
  id: string;
  data: string;
  tags: string;
  deleted: number;
  deleted_tag: string | null;
};

type DrizzleDbClient<
  TTable extends DrizzleTable,
  TTagsTable extends DrizzleTable,
> = {
  select: () => unknown;
  insert: (table: TTable | TTagsTable) => unknown;
};

type DrizzleMaterializerExecutor<TDb> = {
  ensureTagsTable?: (db: TDb) => Promise<void>;
  loadTags: (db: TDb, entity: string, id: string) => Promise<TagsRow | null>;
  saveTags: (db: TDb, entity: string, id: string, dataJson: string, tagsJson: string) => Promise<void>;
  removeTags: (
    db: TDb,
    entity: string,
    id: string,
    dataJson: string,
    tagsJson: string,
    deletedTag: string,
  ) => Promise<void>;
  saveEntity?: (
    db: TDb,
    tableName: string,
    id: string,
    columns: string[],
    values: unknown[],
    updates: string[],
  ) => Promise<void>;
};

type DrizzleSyncMaterializerExecutor<TDb> = {
  ensureTagsTable?: (db: TDb) => void;
  loadTags: (db: TDb, entity: string, id: string) => TagsRow | null;
  saveTags: (db: TDb, entity: string, id: string, dataJson: string, tagsJson: string) => void;
  removeTags: (
    db: TDb,
    entity: string,
    id: string,
    dataJson: string,
    tagsJson: string,
    deletedTag: string,
  ) => void;
  saveEntity?: (
    db: TDb,
    tableName: string,
    id: string,
    columns: string[],
    values: unknown[],
    updates: string[],
  ) => void;
};

type BivariantCallback<Args extends unknown[], Result> = {
  bivarianceHack: (...args: Args) => Result;
}['bivarianceHack'];

type DrizzleMaterializerOptions<
  S extends RippleSchema,
  TTable extends DrizzleTable,
  TConfig extends DrizzleTableConfig,
  TTagsTable extends DrizzleTable,
> = {
  /**
   * Map entity names to their Drizzle table definitions.
   * These tables must already exist in your database.
   */
  tableMap: Record<EntityName<S>, TTable>;

  /**
   * Tags table definition (required to avoid dialect-specific branching).
   */
  tagsTableDef: TTagsTable;

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
  TConfig extends DrizzleTableConfig = DrizzleTableConfig,
  TTagsTable extends DrizzleTable = DrizzleTable,
>(
  options: DrizzleMaterializerOptions<S, TTable, TConfig, TTagsTable>,
): DrizzleMaterializerExecutor<DrizzleDbClient<TTable, TTagsTable>> {
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
    from: (table: TTable | TTagsTable) => {
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

  const executor: DrizzleMaterializerExecutor<DrizzleDbClient<TTable, TTagsTable>> = {
    ensureTagsTable: async (db: DrizzleDbClient<TTable, TTagsTable>) => {
      void db;
      // Optional user hook (noop if not provided)
      if (ensureTagsTable) await ensureTagsTable();
    },
    async loadTags(db: DrizzleDbClient<TTable, TTagsTable>, entity: string, id: string): Promise<TagsRow | null> {
      const dbClient = db;
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
    async saveTags(
      db: DrizzleDbClient<TTable, TTagsTable>,
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
    ): Promise<void> {
      await runWrite(
        (db.insert(tagsTableDef) as InsertChain).values({
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
      db: DrizzleDbClient<TTable, TTagsTable>,
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
      deletedTag: string,
    ): Promise<void> {
      await runWrite(
        (db.insert(tagsTableDef) as InsertChain).values({
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
      db: DrizzleDbClient<TTable, TTagsTable>,
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
        (db.insert(drizzleTable) as InsertChain).values(insertValues).onConflictDoUpdate({
          target: [idColumn],
          set: updateSet,
        }),
      );
    },
  };

  return executor;
}

/**
 * Options for creating a Drizzle materializer adapter.
 */
type CreateDrizzleMaterializerOptions<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  D extends SchemaDescriptor<any>,
  TTable extends DrizzleTable = DrizzleTable,
  TConfig extends DrizzleTableConfig = DrizzleTableConfig,
  TTagsTable extends DrizzleTable = DrizzleTable,
> = {
  schema: D;  // For field discovery only (schema.getFields())
  // NO db parameter! ensureTagsTable is noop/user hook
  tableMap: Record<EntityName<InferSchema<D>>, TTable>;  // Primary mapping: entity → Drizzle table
  tagsTableDef: TTagsTable;
  getTableConfig: BivariantCallback<[TTable], TConfig>;
  fieldMap?: Partial<Record<EntityName<InferSchema<D>>, Record<string, string>>>;
  normalizeValue?: (value: unknown, context: { tableName: string; columnName: string }) => unknown;
  ensureTagsTable?: () => Promise<void> | void;  // Optional user migration hook
};

/**
 * Create a materializer adapter for Drizzle ORM.
 * Uses schema for field discovery and creates adapter directly.
 *
 * @example
 * ```ts
 * const schema = defineSchema({
 *   todos: { id: s.string(), title: s.string(), done: s.boolean() },
 * });
 * 
 * const adapter = createDrizzleMaterializer({
 *   schema,
 *   tableMap: { todos: todosTable },
 *   tagsTableDef: tagsTable,
 *   getTableConfig,
 * });
 * ```
 */
export function createDrizzleMaterializer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  D extends SchemaDescriptor<any>,
  TTable extends DrizzleTable = DrizzleTable,
  TConfig extends DrizzleTableConfig = DrizzleTableConfig,
  TTagsTable extends DrizzleTable = DrizzleTable,
>(
  opts: CreateDrizzleMaterializerOptions<D, TTable, TConfig, TTagsTable>
): MaterializerAdapter<InferSchema<D>, DrizzleDbClient<TTable, TTagsTable>> {
  // Store schema directly in closure (for field discovery)
  const schema = opts.schema;
  
  // Use opts.tableMap directly (primary mapping, no derivation)
  const tableMap = opts.tableMap;
  
  // Derive string tableMap internally
  const stringTableMap: Record<EntityName<InferSchema<D>>, string> = {} as Record<EntityName<InferSchema<D>>, string>;
  for (const [entity, table] of Object.entries(tableMap)) {
    const config = opts.getTableConfig(table);
    stringTableMap[entity as EntityName<InferSchema<D>>] = config.name;
  }
  
  // Create executor (no db needed)
  const executor = createDrizzleMaterializerExecutor({
    tableMap,
    tagsTableDef: opts.tagsTableDef,
    getTableConfig: opts.getTableConfig,
    fieldMap: opts.fieldMap,
    normalizeValue: opts.normalizeValue,
    ensureTagsTable: opts.ensureTagsTable,
  });
  
  // Call ensureTagsTable if provided (noop if not, no db needed)
  // This is a user hook, so we call it immediately if provided
  if (opts.ensureTagsTable) {
    const result = opts.ensureTagsTable();
    void result;
  }
  
  const fieldMap = opts.fieldMap;
  
  const getTableName = <E extends EntityName<InferSchema<D>>>(entity: E): string => {
    const table = stringTableMap[entity];
    if (!table) {
      throw new Error(`No table mapping for entity: ${entity}`);
    }
    return table;
  };
  
  const getColumnName = <E extends EntityName<InferSchema<D>>>(
    entity: E,
    field: string,
  ): string => {
    return fieldMap?.[entity]?.[field] ?? field;
  };
  
  return {
    async load<E extends EntityName<InferSchema<D>>>(
      db: DrizzleDbClient<TTable, TTagsTable>,
      entity: E,
      id: string,
    ): Promise<MaterializerState<InferSchema<D>, E> | null> {
      const row = await executor.loadTags(db, entity, id);
      
      if (!row) return null;
      
      return {
        values: JSON.parse(row.data) as Partial<InferSchema<D>[E]>,
        tags: JSON.parse(row.tags) as ChangeTags<InferSchema<D>, E>,
        deleted: row.deleted === 1,
        deletedTag: row.deleted_tag as Hlc | null,
      };
    },
    
    async save<E extends EntityName<InferSchema<D>>>(
      db: DrizzleDbClient<TTable, TTagsTable>,
      entity: E,
      id: string,
      state: MaterializerState<InferSchema<D>, E>,
    ): Promise<void> {
      const tableName = getTableName(entity);
      const dataJson = JSON.stringify(state.values);
      const tagsJson = JSON.stringify(state.tags);
      
      // Save to tags table
      await executor.saveTags(db, entity, id, dataJson, tagsJson);
      
      // Optionally save values to actual table columns if fieldMap is provided
      if (fieldMap?.[entity] && Object.keys(state.values).length > 0) {
        const columns: string[] = [];
        const values: unknown[] = [];
        const updates: string[] = [];
        
        // Use schema.getFields() for field iteration
        const fields = schema.getFields(entity);
        for (const field of fields) {
          if (!(field in state.values)) continue;
          // Skip 'id' field - it's handled separately
          if (field === 'id') continue;
          const column = getColumnName(entity, field);
          const value = state.values[field as keyof typeof state.values];
          columns.push(column);
          values.push(value);
          updates.push(`${column} = ?`);
        }
        
        if (columns.length > 0) {
          if (!executor.saveEntity) {
            throw new Error('No saveEntity executor provided for fieldMap');
          }
          await executor.saveEntity(db, tableName, id, columns, values, updates);
        }
      }
    },
    
    async remove<E extends EntityName<InferSchema<D>>>(
      db: DrizzleDbClient<TTable, TTagsTable>,
      entity: E,
      id: string,
      state: MaterializerState<InferSchema<D>, E>,
    ): Promise<void> {
      const dataJson = JSON.stringify(state.values);
      const tagsJson = JSON.stringify(state.tags);
      const deletedTag = state.deletedTag ?? '';
      
      await executor.removeTags(db, entity, id, dataJson, tagsJson, deletedTag);
    },
  };
}

/**
 * Create a SYNC materializer adapter for Drizzle ORM (better-sqlite3).
 * Uses the sync executor and returns non-async adapter methods.
 */
export function createDrizzleSyncMaterializer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  D extends SchemaDescriptor<any>,
  TTable extends DrizzleTable = DrizzleTable,
  TConfig extends DrizzleTableConfig = DrizzleTableConfig,
  TTagsTable extends DrizzleTable = DrizzleTable,
>(
  opts: CreateDrizzleMaterializerOptions<D, TTable, TConfig, TTagsTable>
): MaterializerAdapter<InferSchema<D>, DrizzleDbClient<TTable, TTagsTable>> {
  const schema = opts.schema;
  const tableMap = opts.tableMap;

  const stringTableMap: Record<EntityName<InferSchema<D>>, string> = {} as Record<EntityName<InferSchema<D>>, string>;
  for (const [entity, table] of Object.entries(tableMap)) {
    const config = opts.getTableConfig(table);
    stringTableMap[entity as EntityName<InferSchema<D>>] = config.name;
  }

  const executor = createDrizzleSyncMaterializerExecutor({
    tableMap,
    tagsTableDef: opts.tagsTableDef,
    getTableConfig: opts.getTableConfig,
    fieldMap: opts.fieldMap,
    normalizeValue: opts.normalizeValue,
    ensureTagsTable: opts.ensureTagsTable,
  });

  if (opts.ensureTagsTable) {
    const result = opts.ensureTagsTable();
    void result;
  }

  const fieldMap = opts.fieldMap;

  const getTableName = <E extends EntityName<InferSchema<D>>>(entity: E): string => {
    const table = stringTableMap[entity];
    if (!table) {
      throw new Error(`No table mapping for entity: ${entity}`);
    }
    return table;
  };

  const getColumnName = <E extends EntityName<InferSchema<D>>>(
    entity: E,
    field: string,
  ): string => fieldMap?.[entity]?.[field] ?? field;

  const adapter = {
    load<E extends EntityName<InferSchema<D>>>(
      db: DrizzleDbClient<TTable, TTagsTable>,
      entity: E,
      id: string,
    ): MaterializerState<InferSchema<D>, E> | null {
      const row = executor.loadTags(db, entity, id);
      if (!row) return null;
      return {
        values: JSON.parse(row.data) as Partial<InferSchema<D>[E]>,
        tags: JSON.parse(row.tags) as ChangeTags<InferSchema<D>, E>,
        deleted: row.deleted === 1,
        deletedTag: row.deleted_tag as Hlc | null,
      };
    },
    save<E extends EntityName<InferSchema<D>>>(
      db: DrizzleDbClient<TTable, TTagsTable>,
      entity: E,
      id: string,
      state: MaterializerState<InferSchema<D>, E>,
    ): void {
      const tableName = getTableName(entity);
      const dataJson = JSON.stringify(state.values);
      const tagsJson = JSON.stringify(state.tags);
      executor.saveTags(db, entity, id, dataJson, tagsJson);

      if (fieldMap?.[entity] && Object.keys(state.values).length > 0) {
        const columns: string[] = [];
        const values: unknown[] = [];
        const updates: string[] = [];
        const fields = schema.getFields(entity);
        for (const field of fields) {
          if (!(field in state.values)) continue;
          if (field === 'id') continue;
          const column = getColumnName(entity, field);
          const value = state.values[field as keyof typeof state.values];
          columns.push(column);
          values.push(value);
          updates.push(`${column} = ?`);
        }

        if (columns.length > 0) {
          if (!executor.saveEntity) {
            throw new Error('No saveEntity executor provided for fieldMap');
          }
          executor.saveEntity(db, tableName, id, columns, values, updates);
        }
      }
    },
    remove<E extends EntityName<InferSchema<D>>>(
      db: DrizzleDbClient<TTable, TTagsTable>,
      entity: E,
      id: string,
      state: MaterializerState<InferSchema<D>, E>,
    ): void {
      const dataJson = JSON.stringify(state.values);
      const tagsJson = JSON.stringify(state.tags);
      const deletedTag = state.deletedTag ?? '';
      executor.removeTags(db, entity, id, dataJson, tagsJson, deletedTag);
    },
  };

  return adapter;
}

/**
 * Creates a SYNC materializer executor for Drizzle ORM with better-sqlite3.
 * Use this with db-sqlite which requires synchronous operations.
 */
export function createDrizzleSyncMaterializerExecutor<
  S extends RippleSchema,
  TTable extends DrizzleTable = DrizzleTable,
  TConfig extends DrizzleTableConfig = DrizzleTableConfig,
  TTagsTable extends DrizzleTable = DrizzleTable,
>(
  options: DrizzleMaterializerOptions<S, TTable, TConfig, TTagsTable>,
): DrizzleSyncMaterializerExecutor<DrizzleDbClient<TTable, TTagsTable>> {
  const {
    tableMap,
    tagsTableDef,
    ensureTagsTable,
    getTableConfig,
    normalizeValue,
  } = options;

  const tableNameToDrizzleTable = new Map<string, TTable>();

  type SelectChain = {
    from: (table: TTable | TTagsTable) => {
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

  const executor: DrizzleSyncMaterializerExecutor<DrizzleDbClient<TTable, TTagsTable>> = {
    ensureTagsTable: (db: DrizzleDbClient<TTable, TTagsTable>) => {
      void db;
      // Optional user hook (noop if not provided)
      if (ensureTagsTable) ensureTagsTable();
    },
    loadTags(db: DrizzleDbClient<TTable, TTagsTable>, entity: string, id: string): TagsRow | null {
      const dbClient = db;
      const entityColumn = (tagsTableDef as Record<string, unknown>).entity;
      const idColumn = (tagsTableDef as Record<string, unknown>).id;
      const rows = (dbClient.select() as SelectChain)
        .from(tagsTableDef)
        .where(and(eq(entityColumn as never, entity), eq(idColumn as never, id)))
        .limit(1)
        .all();
      return (rows[0] as TagsRow | undefined) ?? null;
    },
    saveTags(
      db: DrizzleDbClient<TTable, TTagsTable>,
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
    ): void {
      const dbClient = db;
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
      db: DrizzleDbClient<TTable, TTagsTable>,
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
      deletedTag: string,
    ): void {
      const dbClient = db;
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
      db: DrizzleDbClient<TTable, TTagsTable>,
      tableName: string,
      id: string,
      columns: string[],
      values: unknown[],
      updates: string[],
    ): void {
      const dbClient = db;
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

