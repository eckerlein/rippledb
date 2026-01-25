import type Database from 'better-sqlite3';
import type {
  ChangeTags,
  ConvergeSchema,
  EntityName,
  Hlc,
} from '@converge/core';
import type { MaterializerState } from '@converge/materialize-core';
import type {
  EntityFieldMap,
  MaterializerConfigBase,
  SqlMaterializerConfig,
  TagsRow,
} from './types';
import { dialects } from './dialects';

/**
 * Synchronous materializer adapter for SQLite.
 * All methods are synchronous and use the same SQLite connection.
 */
export type SyncMaterializerAdapter<S extends ConvergeSchema = ConvergeSchema> = {
  load<E extends EntityName<S>>(entity: E, id: string): MaterializerState<S, E> | null;
  save<E extends EntityName<S>>(entity: E, id: string, state: MaterializerState<S, E>): void;
  remove<E extends EntityName<S>>(entity: E, id: string, state: MaterializerState<S, E>): void;
};

export type SyncMaterializerExecutor = {
  ensureTagsTable?: () => void;
  loadTags: (entity: string, id: string) => TagsRow | null;
  saveTags: (entity: string, id: string, dataJson: string, tagsJson: string) => void;
  removeTags: (
    entity: string,
    id: string,
    dataJson: string,
    tagsJson: string,
    deletedTag: string,
  ) => void;
  saveEntity?: (
    tableName: string,
    id: string,
    columns: string[],
    values: unknown[],
    updates: string[],
  ) => void;
};

/**
 * Create a synchronous SQL executor for SQLite using dialect/custom commands.
 */
export function createSyncSqlExecutor<
  S extends ConvergeSchema = ConvergeSchema,
>(db: Database.Database, config: SqlMaterializerConfig<S>): SyncMaterializerExecutor {
  const tagsTable = config.tagsTable ?? 'converge_tags';
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

  // Ensure tags table exists before preparing statements (required for SQLite)
  if (dialect) {
    const createSql = dialect.createTagsTable(tagsTable);
    db.exec(createSql);
  }

  // Pre-compute commands (they're static templates)
  const loadCmd = getLoadCommand();
  const saveCmd = getSaveCommand();
  const removeCmd = getRemoveCommand();

  // Pre-prepare statements for better performance
  const loadStmt = db.prepare(loadCmd);
  const saveStmt = db.prepare(saveCmd);
  const removeStmt = db.prepare(removeCmd);

  return {
    ensureTagsTable: () => {
      // Already done above during executor creation
    },
    loadTags: (entity: string, id: string): TagsRow | null => {
      return (loadStmt.get(entity, id) as TagsRow | undefined) ?? null;
    },
    saveTags: (entity: string, id: string, dataJson: string, tagsJson: string): void => {
      saveStmt.run(entity, id, dataJson, tagsJson);
    },
    removeTags: (
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
      deletedTag: string,
    ): void => {
      removeStmt.run(entity, id, dataJson, tagsJson, deletedTag);
    },
    saveEntity: (
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
 * Create a synchronous materializer adapter for SQLite.
 * Uses the same SQLite connection and all operations are synchronous.
 *
 * @example
 * ```ts
 * const sqlConfig = {
 *   dialect: 'sqlite',
 *   tableMap: { todos: 'todos' },
 *   fieldMap: { todos: { title: 'todo_title', done: 'is_done' } }
 * };
 * const executor = createSyncSqlExecutor(db, sqlConfig);
 * const adapter = createSyncMaterializer({ ...sqlConfig, executor });
 * ```
 */
export function createSyncMaterializer<
  S extends ConvergeSchema = ConvergeSchema,
>(
  config: MaterializerConfigBase<S> & { executor: SyncMaterializerExecutor },
): SyncMaterializerAdapter<S> {
  const executor: SyncMaterializerExecutor = config.executor;

  // Initialize tags table on first use
  let tagsTableInitialized = false;
  const initTagsTable = () => {
    if (!tagsTableInitialized) {
      if (executor.ensureTagsTable) {
        executor.ensureTagsTable();
      }
      tagsTableInitialized = true;
    }
  };

  const getTableName = <E extends EntityName<S>>(entity: E): string => {
    const table = config.tableMap[entity];
    if (!table) {
      throw new Error(`No table mapping for entity: ${entity}`);
    }
    return table;
  };

  const getFieldMap = <E extends EntityName<S>>(
    entity: E,
  ): EntityFieldMap | null => {
    return (config.fieldMap?.[entity] as EntityFieldMap | undefined) ?? null;
  };

  return {
    load<E extends EntityName<S>>(
      entity: E,
      id: string,
    ): MaterializerState<S, E> | null {
      initTagsTable();
      const row = executor.loadTags(entity, id);

      if (!row) return null;

      return {
        values: JSON.parse(row.data) as Partial<S[E]>,
        tags: JSON.parse(row.tags) as ChangeTags<S, E>,
        deleted: row.deleted === 1,
        deletedTag: row.deleted_tag as Hlc | null,
      };
    },

    save<E extends EntityName<S>>(
      entity: E,
      id: string,
      state: MaterializerState<S, E>,
    ): void {
      initTagsTable();
      const tableName = getTableName(entity);
      const fieldMap = getFieldMap(entity);
      const dataJson = JSON.stringify(state.values);
      const tagsJson = JSON.stringify(state.tags);

      // Save to tags table
      executor.saveTags(entity, id, dataJson, tagsJson);

      // Optionally save values to actual table columns if fieldMap is provided
      if (fieldMap && Object.keys(state.values).length > 0) {
        const columns: string[] = [];
        const values: unknown[] = [];
        const updates: string[] = [];

        for (const [field, value] of Object.entries(state.values)) {
          // Skip 'id' field - it's handled separately as the first parameter in saveEntityCommand
          if (field === 'id') continue;
          const column = fieldMap[field] ?? field;
          columns.push(column);
          values.push(value);
          updates.push(`${column} = ?`);
        }

        if (columns.length > 0) {
          if (!executor.saveEntity) {
            throw new Error('No saveEntity executor provided for fieldMap');
          }
          executor.saveEntity(tableName, id, columns, values, updates);
        }
      }
    },

    remove<E extends EntityName<S>>(
      entity: E,
      id: string,
      state: MaterializerState<S, E>,
    ): void {
      initTagsTable();
      const dataJson = JSON.stringify(state.values);
      const tagsJson = JSON.stringify(state.tags);
      const deletedTag = state.deletedTag ?? '';

      executor.removeTags(entity, id, dataJson, tagsJson, deletedTag);
    },
  };
}
