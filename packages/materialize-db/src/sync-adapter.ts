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

  // Resolve dialect: TypeScript ensures either dialect OR all custom commands are provided
  const dialect = config.dialect ? dialects[config.dialect] : undefined;

  if (!dialect && !('loadCommand' in config)) {
    throw new Error('Invalid config: must provide either dialect or all custom commands');
  }

  // Ensure tags table exists (synchronous)
  const ensureTagsTable = () => {
    if (dialect) {
      const sql = dialect.createTagsTable(tagsTable);
      db.exec(sql);
    }
    // If no dialect and no custom create, assume table exists or user handles it
  };

  // Initialize tags table on first use
  let tagsTableInitialized = false;
  const initTagsTable = () => {
    if (!tagsTableInitialized) {
      ensureTagsTable();
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
    load<E extends EntityName<S>>(
      entity: E,
      id: string,
    ): MaterializerState<S, E> | null {
      initTagsTable();
      const command = loadCommand(entity, id);
      const stmt = db.prepare(command);
      const row = stmt.get(entity, id) as TagsRow | undefined;

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
      const command = saveCommand(entity, id, dataJson, tagsJson);
      const stmt = db.prepare(command);
      stmt.run(entity, id, dataJson, tagsJson);

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

      const command = removeCommand(entity, id, dataJson, tagsJson, deletedTag);
      const stmt = db.prepare(command);
      stmt.run(entity, id, dataJson, tagsJson, deletedTag);
    },
  };
}
