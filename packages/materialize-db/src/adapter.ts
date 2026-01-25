import type {
  ChangeTags,
  ConvergeSchema,
  EntityName,
  Hlc,
} from '@converge/core';
import type { MaterializerAdapter, MaterializerState } from '@converge/materialize-core';
import type {
  CustomMaterializerConfig,
  EntityFieldMap,
  MaterializerExecutor,
  TagsRow,
} from './types';
import { dialects } from './dialects';

/**
 * Create a custom materialization adapter for any database.
 *
 * Works with any database by providing a dialect name (e.g., 'sqlite', 'postgresql')
 * or custom command hooks. Entity tables must already exist; tags are stored separately
 * and auto-created on first use.
 *
 * @example
 * ```ts
 * const adapter = createCustomMaterializer({
 *   db: myDb,
 *   dialect: 'sqlite',
 *   tableMap: { todos: 'todos' },
 *   fieldMap: { todos: { title: 'todo_title', done: 'is_done' } }
 * });
 * ```
 */
export function createCustomMaterializer<
  S extends ConvergeSchema = ConvergeSchema,
>(config: CustomMaterializerConfig<S>): MaterializerAdapter<S> {
  const tagsTable = config.tagsTable ?? 'converge_tags';

  const hasExecutor = 'executor' in config;
  const sqlConfig = !hasExecutor && 'db' in config ? config : null;
  // Resolve dialect: TypeScript ensures either dialect OR all custom commands are provided
  const dialect =
    !hasExecutor && 'dialect' in config && config.dialect ? dialects[config.dialect] : undefined;

  if (!hasExecutor && !sqlConfig) {
    throw new Error('Invalid config: SQL materializer requires db');
  }

  if (!hasExecutor && !dialect && !('loadCommand' in config)) {
    throw new Error('Invalid config: must provide executor, dialect, or custom commands');
  }

  const createSqlExecutor = (): MaterializerExecutor => {
    if (!sqlConfig) {
      throw new Error('Invalid config: SQL materializer requires db');
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
      ensureTagsTable: async () => {
        if (dialect) {
          const sql = dialect.createTagsTable(tagsTable);
          await sqlConfig.db.run(sql, []);
        }
      },
      async loadTags(entity: string, id: string): Promise<TagsRow | null> {
        const command = loadCommand(entity, id);
        return await sqlConfig.db.get<TagsRow>(command, [entity, id]);
      },
      async saveTags(
        entity: string,
        id: string,
        dataJson: string,
        tagsJson: string,
      ): Promise<void> {
        const command = saveCommand(entity, id, dataJson, tagsJson);
        await sqlConfig.db.run(command, [entity, id, dataJson, tagsJson]);
      },
      async removeTags(
        entity: string,
        id: string,
        dataJson: string,
        tagsJson: string,
        deletedTag: string,
      ): Promise<void> {
        const command = removeCommand(entity, id, dataJson, tagsJson, deletedTag);
        await sqlConfig.db.run(command, [entity, id, dataJson, tagsJson, deletedTag]);
      },
      async saveEntity(
        tableName: string,
        id: string,
        columns: string[],
        values: unknown[],
        updates: string[],
      ): Promise<void> {
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

        await sqlConfig.db.run(command, params);
      },
    };
  };

  const executor = hasExecutor ? config.executor : createSqlExecutor();
  if (!executor) {
    throw new Error('Invalid config: executor is required');
  }

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
