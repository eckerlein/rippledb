import type {
  ChangeTags,
  ConvergeSchema,
  EntityName,
  Hlc,
} from '@converge/core';
import type { MaterializerAdapter, MaterializerState } from '@converge/materialize-core';
import type {
  CustomMaterializerConfig,
  Db,
  EntityFieldMap,
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
  S extends ConvergeSchema = ConvergeSchema,
>(config: SqlMaterializerConfig<S>, db: Db): MaterializerExecutor {
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

  // Pre-compute commands (they're static templates)
  const loadCmd = getLoadCommand();
  const saveCmd = getSaveCommand();
  const removeCmd = getRemoveCommand();

  return {
    ensureTagsTable: async () => {
      if (dialect) {
        const sql = dialect.createTagsTable(tagsTable);
        await db.run(sql, []);
      }
    },
    async loadTags(entity: string, id: string): Promise<TagsRow | null> {
      return await db.get<TagsRow>(loadCmd, [entity, id]);
    },
    async saveTags(
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
    ): Promise<void> {
      await db.run(saveCmd, [entity, id, dataJson, tagsJson]);
    },
    async removeTags(
      entity: string,
      id: string,
      dataJson: string,
      tagsJson: string,
      deletedTag: string,
    ): Promise<void> {
      await db.run(removeCmd, [entity, id, dataJson, tagsJson, deletedTag]);
    },
    async saveEntity(
      tableName: string,
      id: string,
      columns: string[],
      values: unknown[],
      updates: string[],
    ): Promise<void> {
      const { sql, params } = getSaveEntityCommand(tableName, id, columns, values, updates);
      await db.run(sql, params);
    },
  };
}

export function createCustomMaterializer<
  S extends ConvergeSchema = ConvergeSchema,
>(config: CustomMaterializerConfig<S>): MaterializerAdapter<S> {
  const executor = config.executor;

  // Initialize tags table on first use
  let tagsTableInitialized = false;
  const initTagsTable = async () => {
    if (!tagsTableInitialized) {
      if (executor.ensureTagsTable) {
        await executor.ensureTagsTable();
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
    async load<E extends EntityName<S>>(
      entity: E,
      id: string,
    ): Promise<MaterializerState<S, E> | null> {
      await initTagsTable();
      const row = await executor.loadTags(entity, id);

      if (!row) return null;

      return {
        values: JSON.parse(row.data) as Partial<S[E]>,
        tags: JSON.parse(row.tags) as ChangeTags<S, E>,
        deleted: row.deleted === 1,
        deletedTag: row.deleted_tag as Hlc | null,
      };
    },

    async save<E extends EntityName<S>>(
      entity: E,
      id: string,
      state: MaterializerState<S, E>,
    ): Promise<void> {
      await initTagsTable();
      const tableName = getTableName(entity);
      const fieldMap = getFieldMap(entity);
      const dataJson = JSON.stringify(state.values);
      const tagsJson = JSON.stringify(state.tags);

      // Save to tags table
      await executor.saveTags(entity, id, dataJson, tagsJson);

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
          await executor.saveEntity(tableName, id, columns, values, updates);
        }
      }
    },

    async remove<E extends EntityName<S>>(
      entity: E,
      id: string,
      state: MaterializerState<S, E>,
    ): Promise<void> {
      await initTagsTable();
      const dataJson = JSON.stringify(state.values);
      const tagsJson = JSON.stringify(state.tags);
      const deletedTag = state.deletedTag ?? '';

      await executor.removeTags(entity, id, dataJson, tagsJson, deletedTag);
    },
  };
}
