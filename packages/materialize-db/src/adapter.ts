import type {
  ChangeTags,
  RippleSchema,
  EntityName,
  Hlc,
  MaterializerDb,
  SchemaDescriptor,
  InferSchema,
} from '@rippledb/core';
import type { MaterializerAdapter, MaterializerState } from '@rippledb/materialize-core';
import type {
  MaterializerExecutor,
  SqlMaterializerConfig,
  TagsRow,
} from './types';
import { dialects } from './dialects';

/**
 * Create a custom materialization adapter for any database.
 *
 * Works with any database by providing an executor. For SQL databases, you can
 * build an executor with a dialect or custom command hooks, then pass it in.
 *
 * @example
 * ```ts
 * const sqlConfig = {
 *   dialect: 'sqlite',
 *   tableMap: { todos: 'todos' },
 *   fieldMap: { todos: { title: 'todo_title', done: 'is_done' } }
 * };
 * const executor = createSqlExecutor(sqlConfig, myDb);
 * const adapter = createCustomMaterializer({
 *   ...sqlConfig,
 *   executor,
 * });
 * ```
 */
export function createSqlExecutor<
  S extends RippleSchema = RippleSchema,
>(config: SqlMaterializerConfig<S>): MaterializerExecutor {
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
    ensureTagsTable: async (db: MaterializerDb) => {
      if (dialect) {
        const sql = dialect.createTagsTable(tagsTable);
        const result = db.run(sql, []);
        if (result instanceof Promise) {
          await result;
        }
      }
    },
    async loadTags(db: MaterializerDb, entity: string, id: string): Promise<TagsRow | null> {
      const result = db.get<TagsRow>(loadCmd, [entity, id]);
      if (result instanceof Promise) {
        return await result;
      }
      return result;
    },
    async saveTags(
      db: MaterializerDb,
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
    ): Promise<void> {
      const result = db.run(saveCmd, [entity, id, dataJson, tagsJson]);
      if (result instanceof Promise) {
        await result;
      }
    },
    async removeTags(
      db: MaterializerDb,
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
      deletedTag: string,
    ): Promise<void> {
      const result = db.run(removeCmd, [entity, id, dataJson, tagsJson, deletedTag]);
      if (result instanceof Promise) {
        await result;
      }
    },
    async saveEntity(
      db: MaterializerDb,
      tableName: string,
      id: string,
      columns: string[],
      values: unknown[],
      updates: string[],
    ): Promise<void> {
      const { sql, params } = getSaveEntityCommand(tableName, id, columns, values, updates);
      const result = db.run(sql, params);
      if (result instanceof Promise) {
        await result;
      }
    },
  };
}

/**
 * Options for creating a materializer adapter.
 */
type CreateMaterializerOptions<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  D extends SchemaDescriptor<any>,
> = {
  schema: D;
  db: MaterializerDb;  // Required for ensureTagsTable (creates tables)
  tableMap?: Partial<Record<EntityName<InferSchema<D>>, string>>;
  fieldMap?: Partial<Record<EntityName<InferSchema<D>>, Record<string, string>>>;
  tagsTable?: string;
} & (
  | { executor: MaterializerExecutor; dialect?: never }
  | { executor?: never; dialect: 'sqlite' | 'postgresql' }
);

/**
 * Create a materializer adapter for any database.
 * Uses schema for entity/field discovery and creates adapter directly.
 *
 * @example
 * ```ts
 * const schema = defineSchema({
 *   todos: { id: s.string(), title: s.string(), done: s.boolean() },
 * });
 * 
 * const adapter = createMaterializer({
 *   schema,
 *   db,
 *   dialect: 'sqlite',
 *   // Optional overrides:
 *   tableMap: { todos: 'app_todos' },
 *   fieldMap: { todos: { done: 'is_done' } },
 * });
 * ```
 */
export function createMaterializer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  D extends SchemaDescriptor<any>,
>(
  opts: CreateMaterializerOptions<D>
): MaterializerAdapter<InferSchema<D>> {
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
  const executor: MaterializerExecutor = opts.executor ?? createSqlExecutor({
    dialect: opts.dialect!,
    tableMap,
    fieldMap,
    tagsTable: opts.tagsTable,
  });
  
  // Initialize tags table immediately
  if (executor.ensureTagsTable) {
    const initResult = executor.ensureTagsTable(opts.db);
    // If async, we can't await here, but that's okay - first use will handle it
    if (initResult instanceof Promise) {
      // Fire and forget - errors will surface on first use
      initResult.catch(() => {});
    }
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
  
  const adapter: MaterializerAdapter<InferSchema<D>> = {
    async load<E extends EntityName<InferSchema<D>>>(
      db: MaterializerDb,
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
      db: MaterializerDb,
      entity: E,
      id: string,
      state: MaterializerState<InferSchema<D>, E>,
    ): Promise<void> {
      const tableName = getTableName(entity);
      const dataJson = JSON.stringify(state.values);
      const tagsJson = JSON.stringify(state.tags);
      
      // Save to tags table
      await executor.saveTags(db, entity, id, dataJson, tagsJson);
      
      // Save values to actual table columns
      if (Object.keys(state.values).length > 0) {
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
          await executor.saveEntity(db, tableName, id, columns, values, updates);
        }
      }
    },
    
    async remove<E extends EntityName<InferSchema<D>>>(
      db: MaterializerDb,
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
  
  return adapter;
}
