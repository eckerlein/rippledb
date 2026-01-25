import type Database from 'better-sqlite3';
import type {
  ChangeTags,
  ConvergeSchema,
  EntityName,
  Hlc,
} from '@converge/core';
import type { MaterializerState } from '@converge/materialize-core';
import type {
  CustomMaterializerConfig,
  EntityFieldMap,
  MaterializerExecutor,
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
 * Create a synchronous materializer adapter for SQLite.
 * Uses the same SQLite connection and all operations are synchronous.
 *
 * @example
 * ```ts
 * const adapter = createSyncMaterializer(db, {
 *   dialect: 'sqlite',
 *   tableMap: { todos: 'todos' },
 *   fieldMap: { todos: { title: 'todo_title', done: 'is_done' } }
 * });
 * ```
 */
export function createSyncMaterializer<
  S extends ConvergeSchema = ConvergeSchema,
>(
  db: Database.Database,
  config: Omit<CustomMaterializerConfig<S>, 'db'>,
): SyncMaterializerAdapter<S> {
  const tagsTable = config.tagsTable ?? 'converge_tags';

  const hasExecutor = 'executor' in config;
  const sqlConfig = !hasExecutor ? config : null;
  // Resolve dialect: TypeScript ensures either dialect OR all custom commands are provided
  const dialect =
    !hasExecutor && 'dialect' in config && config.dialect ? dialects[config.dialect] : undefined;

  if (!hasExecutor && !dialect && !('loadCommand' in config)) {
    throw new Error('Invalid config: must provide executor, dialect, or custom commands');
  }

  const createSqlExecutor = (): SyncMaterializerExecutor => {
    if (!sqlConfig) {
      throw new Error('Invalid config: SQL materializer requires config');
    }
    const loadCommand = (entity: string, id: string): string => {
      if ('loadCommand' in config && config.loadCommand) {
        return config.loadCommand(tagsTable, entity, id);
      }
      if (dialect) {
        return dialect.loadCommand(tagsTable);
      }
      throw new Error('No loadCommand provided and no dialect specified');
    };

    const saveCommand = (
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
    ): string => {
      if ('saveCommand' in config && config.saveCommand) {
        return config.saveCommand(tagsTable, entity, id, dataJson, tagsJson);
      }
      if (dialect) {
        return dialect.saveCommand(tagsTable);
      }
      throw new Error('No saveCommand provided and no dialect specified');
    };

    const removeCommand = (
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
      deletedTag: string,
    ): string => {
      if ('removeCommand' in config && config.removeCommand) {
        return config.removeCommand(tagsTable, entity, id, dataJson, tagsJson, deletedTag);
      }
      if (dialect) {
        return dialect.removeCommand(tagsTable);
      }
      throw new Error('No removeCommand provided and no dialect specified');
    };

    return {
      ensureTagsTable: () => {
        if (dialect) {
          const sql = dialect.createTagsTable(tagsTable);
          db.exec(sql);
        }
      },
      loadTags: (entity: string, id: string): TagsRow | null => {
        const command = loadCommand(entity, id);
        const stmt = db.prepare(command);
        return (stmt.get(entity, id) as TagsRow | undefined) ?? null;
      },
      saveTags: (entity: string, id: string, dataJson: string, tagsJson: string): void => {
        const command = saveCommand(entity, id, dataJson, tagsJson);
        const stmt = db.prepare(command);
        stmt.run(entity, id, dataJson, tagsJson);
      },
      removeTags: (
        entity: string,
        id: string,
        dataJson: string,
        tagsJson: string,
        deletedTag: string,
      ): void => {
        const command = removeCommand(entity, id, dataJson, tagsJson, deletedTag);
        const stmt = db.prepare(command);
        stmt.run(entity, id, dataJson, tagsJson, deletedTag);
      },
      saveEntity: (
        tableName: string,
        id: string,
        columns: string[],
        values: unknown[],
        updates: string[],
      ): void => {
        let command: string;
        let params: unknown[];

        if ('saveEntityCommand' in config && config.saveEntityCommand) {
          const result = config.saveEntityCommand(tableName, id, columns, values, updates);
          command = result.sql;
          params = result.params;
        } else if (dialect) {
          const result = dialect.saveEntityCommand(tableName, id, columns, values, updates);
          command = result.sql;
          params = result.params;
        } else {
          throw new Error('No saveEntityCommand provided and no dialect specified');
        }

        const entityStmt = db.prepare(command);
        entityStmt.run(...params);
      },
    };
  };

  const executor: SyncMaterializerExecutor = hasExecutor
    ? (config.executor as unknown as SyncMaterializerExecutor)
    : createSqlExecutor();

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
