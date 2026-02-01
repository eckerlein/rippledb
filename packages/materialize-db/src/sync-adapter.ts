import type Database from 'better-sqlite3';
import type {
  ChangeTags,
  RippleSchema,
  EntityName,
  Hlc,
  MaterializerDb,
  SchemaDescriptor,
  InferSchema,
} from '@rippledb/core';
import type { MaterializerState } from '@rippledb/materialize-core';
import type {
  SqlMaterializerConfig,
  TagsRow,
} from './types';
import { dialects } from './dialects';

/**
 * Synchronous materializer adapter for SQLite.
 * All methods are synchronous and use the same SQLite connection.
 * Methods receive db as first parameter (stateless).
 */
export type SyncMaterializerAdapter<
  S extends RippleSchema = RippleSchema,
  TDb = MaterializerDb,
> = {
  load<E extends EntityName<S>>(db: TDb, entity: E, id: string): MaterializerState<S, E> | null;
  save<E extends EntityName<S>>(db: TDb, entity: E, id: string, state: MaterializerState<S, E>): void;
  remove<E extends EntityName<S>>(db: TDb, entity: E, id: string, state: MaterializerState<S, E>): void;
};

/**
 * Synchronous executor for materialization operations.
 * 
 * Executors are stateless - they receive the transaction-bound database instance
 * as the first parameter to all methods. This allows executors to be created once
 * and reused across transactions.
 * 
 * For SQLite, the db parameter will be a SqliteDatabase instance (better-sqlite3),
 * which implements MaterializerDb with synchronous methods.
 */
export type SyncMaterializerExecutor<TDb = MaterializerDb> = {
  /**
   * Ensure tags table/collection exists. Optional.
   * Receives the transaction-bound database instance.
   */
  ensureTagsTable?: (db: TDb) => void;

  /**
   * Load tags row for a specific entity + id.
   * Receives the transaction-bound database instance as first parameter.
   */
  loadTags: (db: TDb, entity: string, id: string) => TagsRow | null;

  /**
   * Save tags row for a specific entity + id.
   * Receives the transaction-bound database instance as first parameter.
   */
  saveTags: (db: TDb, entity: string, id: string, dataJson: string, tagsJson: string) => void;

  /**
   * Remove (tombstone) tags row for a specific entity + id.
   * Receives the transaction-bound database instance as first parameter.
   */
  removeTags: (
    db: TDb,
    entity: string,
    id: string,
    dataJson: string,
    tagsJson: string,
    deletedTag: string,
  ) => void;

  /**
   * Save entity values to the domain table/collection (when fieldMap is provided).
   * Receives the transaction-bound database instance as first parameter.
   */
  saveEntity?: (
    db: TDb,
    tableName: string,
    id: string,
    columns: string[],
    values: unknown[],
    updates: string[],
  ) => void;
};

/**
 * Create a synchronous SQL executor for SQLite using dialect/custom commands.
 * 
 * Executor is stateless - it receives db as parameter in all methods.
 * Table initialization is handled by the materializer constructor.
 */
export function createSyncSqlExecutor<
  S extends RippleSchema = RippleSchema,
>(config: SqlMaterializerConfig<S>): SyncMaterializerExecutor<Database.Database> {
  const tagsTable = config.tagsTable ?? 'ripple_tags';
  const dialect =
    'dialect' in config && config.dialect ? dialects[config.dialect] : undefined;

  if (!dialect && !('loadCommand' in config)) {
    throw new Error('Invalid config: must provide dialect or custom commands');
  }

  const getLoadCommand = (): string => {
    if ('loadCommand' in config && config.loadCommand) {
      return config.loadCommand(tagsTable);
    }
    if (dialect) {
      return dialect.loadCommand(tagsTable);
    }
    throw new Error('No loadCommand provided and no dialect specified');
  };

  const getSaveCommand = (): string => {
    if ('saveCommand' in config && config.saveCommand) {
      return config.saveCommand(tagsTable);
    }
    if (dialect) {
      return dialect.saveCommand(tagsTable);
    }
    throw new Error('No saveCommand provided and no dialect specified');
  };

  const getRemoveCommand = (): string => {
    if ('removeCommand' in config && config.removeCommand) {
      return config.removeCommand(tagsTable);
    }
    if (dialect) {
      return dialect.removeCommand(tagsTable);
    }
    throw new Error('No removeCommand provided and no dialect specified');
  };

  const getSaveEntityCommand = (
    tableName: string,
    id: string,
    columns: string[],
    values: unknown[],
    updates: string[],
  ): { sql: string; params: unknown[] } => {
    if ('saveEntityCommand' in config && config.saveEntityCommand) {
      return config.saveEntityCommand(tableName, id, columns, values, updates);
    }
    if (dialect) {
      return dialect.saveEntityCommand(tableName, id, columns, values, updates);
    }
    throw new Error('No saveEntityCommand provided and no dialect specified');
  };

  // Pre-compute commands (they're static templates)
  const loadCmd = getLoadCommand();
  const saveCmd = getSaveCommand();
  const removeCmd = getRemoveCommand();

  return {
    ensureTagsTable: (db: Database.Database) => {
      // Initialize tags table using the provided db instance
      if (dialect) {
        const createSql = dialect.createTagsTable(tagsTable);
        db.exec(createSql);
      }
    },
    loadTags: (db: Database.Database, entity: string, id: string): TagsRow | null => {
      const stmt = db.prepare(loadCmd);
      return (stmt.get(entity, id) as TagsRow | undefined) ?? null;
    },
    saveTags: (db: Database.Database, entity: string, id: string, dataJson: string, tagsJson: string): void => {
      const stmt = db.prepare(saveCmd);
      stmt.run(entity, id, dataJson, tagsJson);
    },
    removeTags: (
      db: Database.Database,
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
      deletedTag: string,
    ): void => {
      const stmt = db.prepare(removeCmd);
      stmt.run(entity, id, dataJson, tagsJson, deletedTag);
    },
    saveEntity: (
      db: Database.Database,
      tableName: string,
      id: string,
      columns: string[],
      values: unknown[],
      updates: string[],
    ): void => {
      const { sql, params } = getSaveEntityCommand(tableName, id, columns, values, updates);
      const entityStmt = db.prepare(sql);
      entityStmt.run(...params);
    },
  };
}

/**
 * Options for creating a synchronous materializer adapter.
 */
type CreateSyncMaterializerOptions<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  D extends SchemaDescriptor<any>,
> = {
  schema: D;
  db: Database.Database;  // Required for ensureTagsTable (creates tables)
  tableMap?: Partial<Record<EntityName<InferSchema<D>>, string>>;
  fieldMap?: Partial<Record<EntityName<InferSchema<D>>, Record<string, string>>>;
  tagsTable?: string;
} & (
  | { executor: SyncMaterializerExecutor<Database.Database>; dialect?: never }
  | { executor?: never; dialect: 'sqlite' }
);

/**
 * Create a synchronous materializer adapter for SQLite.
 * Uses schema for entity/field discovery and creates adapter directly.
 *
 * @example
 * ```ts
 * const schema = defineSchema({
 *   todos: { id: s.string(), title: s.string(), done: s.boolean() },
 * });
 * 
 * const adapter = createSyncMaterializer({
 *   schema,
 *   db,
 *   dialect: 'sqlite',
 *   // Optional overrides:
 *   tableMap: { todos: 'app_todos' },
 *   fieldMap: { todos: { done: 'is_done' } },
 * });
 * ```
 */
export function createSyncMaterializer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  D extends SchemaDescriptor<any>,
>(
  opts: CreateSyncMaterializerOptions<D>
): SyncMaterializerAdapter<InferSchema<D>, Database.Database> {
  // Store schema directly in closure (source of truth)
  const schema = opts.schema;
  
  // Derive tableMap from schema.entities (with optional overrides)
  const tableMap: Record<EntityName<InferSchema<D>>, string> = {} as Record<EntityName<InferSchema<D>>, string>;
  for (const entity of schema.entities) {
    tableMap[entity as EntityName<InferSchema<D>>] = opts.tableMap?.[entity as EntityName<InferSchema<D>>] ?? entity;
  }
  
  // Store fieldMap as optional overrides only
  const fieldMap = opts.fieldMap;
  
  // Get executor
  const executor: SyncMaterializerExecutor<Database.Database> = opts.executor ?? createSyncSqlExecutor({
    dialect: opts.dialect!,
    tableMap,
    fieldMap,
    tagsTable: opts.tagsTable,
  });
  
  // Initialize tags table immediately
  if (executor.ensureTagsTable) {
    executor.ensureTagsTable(opts.db);
  }
  
  const getTableName = <E extends EntityName<InferSchema<D>>>(entity: E): string => {
    const table = tableMap[entity];
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
    load<E extends EntityName<InferSchema<D>>>(
      db: Database.Database,
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
      db: Database.Database,
      entity: E,
      id: string,
      state: MaterializerState<InferSchema<D>, E>,
    ): void {
      const tableName = getTableName(entity);
      const dataJson = JSON.stringify(state.values);
      const tagsJson = JSON.stringify(state.tags);
      
      // Save to tags table
      executor.saveTags(db, entity, id, dataJson, tagsJson);
      
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
          executor.saveEntity(db, tableName, id, columns, values, updates);
        }
      }
    },
    
    remove<E extends EntityName<InferSchema<D>>>(
      db: Database.Database,
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
}
