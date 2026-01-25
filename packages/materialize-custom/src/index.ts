import type {
  ChangeTags,
  ConvergeSchema,
  EntityName,
  Hlc,
} from '@converge/core';
import type {
  MaterializerAdapter,
  MaterializerState,
} from '@converge/materialize-core';

/**
 * Database interface for materialization.
 * Implement this to provide database persistence. Works with any database
 * (SQL, MongoDB, DynamoDB, etc.) as long as you provide the appropriate
 * query/command strings in the hooks.
 */
export type Db = {
  /**
   * Execute a query/command that returns a single row/document.
   * Returns null if no result found.
   */
  get<T = unknown>(query: string, params: unknown[]): Promise<T | null>;

  /**
   * Execute a query/command that doesn't return rows (INSERT/UPDATE/DELETE, etc.).
   */
  run(command: string, params: unknown[]): Promise<void>;
};

/**
 * Entity field mapping configuration.
 * Maps schema field names to database column/field names.
 */
export type EntityFieldMap = Record<string, string>;

/**
 * Dialect configuration for a specific database.
 */
export type Dialect = {
  /**
   * Command to create the tags table/collection.
   * Receives: (tagsTable) and should create the storage for tags.
   */
  createTagsTable: (tagsTable: string) => string;

  /**
   * Command for loading entity state.
   * Receives: (tagsTable) and should return command with placeholders for entity and id.
   * The command should return columns: data, tags, deleted, deleted_tag
   */
  loadCommand: (tagsTable: string) => string;

  /**
   * Command for saving entity state.
   * Receives: (tagsTable) and should return command with placeholders for entity, id, dataJson, tagsJson.
   * Should handle upsert.
   */
  saveCommand: (tagsTable: string) => string;

  /**
   * Command for removing (tombstoning) entity state.
   * Receives: (tagsTable) and should return command with placeholders for entity, id, dataJson, tagsJson, deletedTag.
   * Should handle upsert with deleted flag.
   */
  removeCommand: (tagsTable: string) => string;

  /**
   * Command for saving entity values to actual table columns (when fieldMap is provided).
   * Receives: (tableName, id, columns, values, updates) and should handle upsert.
   */
  saveEntityCommand: (
    tableName: string,
    id: string,
    columns: string[],
    values: unknown[],
    updates: string[],
  ) => { sql: string; params: unknown[] };
};

/**
 * Built-in database dialects.
 */
export const dialects: Record<string, Dialect> = {
  sqlite: {
    createTagsTable: (tagsTable) =>
      `CREATE TABLE IF NOT EXISTS ${tagsTable} (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        tags TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        deleted_tag TEXT,
        PRIMARY KEY (entity, id)
      )`,
    loadCommand: (tagsTable) =>
      `SELECT data, tags, deleted, deleted_tag FROM ${tagsTable} WHERE entity = ? AND id = ?`,
    saveCommand: (tagsTable) =>
      `INSERT INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag)
       VALUES (?, ?, ?, ?, 0, NULL)
       ON CONFLICT(entity, id) DO UPDATE SET
         data = excluded.data,
         tags = excluded.tags,
         deleted = 0,
         deleted_tag = NULL`,
    removeCommand: (tagsTable) =>
      `INSERT INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(entity, id) DO UPDATE SET
         data = excluded.data,
         tags = excluded.tags,
         deleted = 1,
         deleted_tag = excluded.deleted_tag`,
    saveEntityCommand: (tableName, id, columns, values, updates) => ({
      sql: `INSERT INTO ${tableName} (id, ${columns.join(', ')})
            VALUES (?, ${columns.map(() => '?').join(', ')})
            ON CONFLICT(id) DO UPDATE SET
              ${updates.join(', ')}`,
      params: [id, ...values, ...values],
    }),
  },
  postgresql: {
    createTagsTable: (tagsTable) =>
      `CREATE TABLE IF NOT EXISTS ${tagsTable} (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        tags TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        deleted_tag TEXT,
        PRIMARY KEY (entity, id)
      )`,
    loadCommand: (tagsTable) =>
      `SELECT data, tags, deleted, deleted_tag FROM ${tagsTable} WHERE entity = $1 AND id = $2`,
    saveCommand: (tagsTable) =>
      `INSERT INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag)
       VALUES ($1, $2, $3, $4, 0, NULL)
       ON CONFLICT (entity, id) DO UPDATE SET
         data = EXCLUDED.data,
         tags = EXCLUDED.tags,
         deleted = 0,
         deleted_tag = NULL`,
    removeCommand: (tagsTable) =>
      `INSERT INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag)
       VALUES ($1, $2, $3, $4, 1, $5)
       ON CONFLICT (entity, id) DO UPDATE SET
         data = EXCLUDED.data,
         tags = EXCLUDED.tags,
         deleted = 1,
         deleted_tag = EXCLUDED.deleted_tag`,
    saveEntityCommand: (tableName, id, columns, values, updates) => {
      const insertPlaceholders = columns.map((_, i) => `$${i + 2}`).join(', ');
      const updateClauses = updates.map((u, i) => u.replace('?', `$${i + 2 + columns.length}`));
      return {
        sql: `INSERT INTO ${tableName} (id, ${columns.join(', ')})
              VALUES ($1, ${insertPlaceholders})
              ON CONFLICT (id) DO UPDATE SET
                ${updateClauses.join(', ')}`,
        params: [id, ...values, ...values],
      };
    },
  },
};

/**
 * Configuration for custom materialization adapter.
 * Works with any database by providing a dialect name or custom query/command strings.
 */
export type CustomMaterializerConfig<
  S extends ConvergeSchema = ConvergeSchema,
> = {
  /**
   * Database instance. Can be SQL, MongoDB, DynamoDB, etc.
   */
  db: Db;

  /**
   * Table/collection name for storing entity tags/metadata.
   * Default: 'converge_tags'
   */
  tagsTable?: string;

  /**
   * Map entity names to their database table/collection names.
   * These must already exist in your database.
   */
  tableMap: Record<EntityName<S>, string>;

  /**
   * Map entity names to their field-to-column mappings.
   * If omitted, field names are used as column/field names.
   * The columns/fields must already exist in the corresponding tables/collections.
   */
  fieldMap?: Partial<Record<EntityName<S>, EntityFieldMap>>;

  /**
   * Database dialect name (e.g., 'sqlite', 'postgresql').
   * If provided, uses pre-configured SQL for that dialect.
   * If omitted, you must provide custom hooks.
   */
  dialect?: keyof typeof dialects;

  /**
   * Custom command for loading entity state.
   * Overrides dialect default if provided.
   * Receives: (tagsTable, entity, id) and should return command with placeholders.
   */
  loadCommand?: (tagsTable: string, entity: string, id: string) => string;

  /**
   * Custom command for saving entity state.
   * Overrides dialect default if provided.
   * Receives: (tagsTable, entity, id, dataJson, tagsJson) and should return command with placeholders.
   */
  saveCommand?: (
    tagsTable: string,
    entity: string,
    id: string,
    dataJson: string,
    tagsJson: string,
  ) => string;

  /**
   * Custom command for removing (tombstoning) entity state.
   * Overrides dialect default if provided.
   * Receives: (tagsTable, entity, id, dataJson, tagsJson, deletedTag) and should return command with placeholders.
   */
  removeCommand?: (
    tagsTable: string,
    entity: string,
    id: string,
    dataJson: string,
    tagsJson: string,
    deletedTag: string,
  ) => string;

  /**
   * Custom command for saving entity values to actual table columns (when fieldMap is provided).
   * Overrides dialect default if provided.
   */
  saveEntityCommand?: (
    tableName: string,
    id: string,
    columns: string[],
    values: unknown[],
    updates: string[],
  ) => { sql: string; params: unknown[] };
};

type TagsRow = {
  id: string;
  data: string;
  tags: string;
  deleted: number;
  deleted_tag: string | null;
};

/**
 * Create a custom materialization adapter.
 *
 * This adapter works with any database by using a dialect name or custom
 * query/command strings. It stores entity values in actual database
 * structures (via fieldMap) and stores tags/metadata separately.
 *
 * **Important:**
 * - Entity tables/collections (e.g., `todos`, `users`) must already exist.
 *   The materializer does NOT create or maintain them.
 * - Entity structures only need data fields. They do NOT need tag fields.
 *   Tags are stored separately in a tags table/collection.
 * - The tags table/collection is auto-created on first use (via dialect or custom hook).
 * - The materializer assumes entity structures match the schema defined by
 *   `tableMap` and `fieldMap`.
 * - Provide a `dialect` name (e.g., 'sqlite', 'postgresql') OR custom hooks.
 *   Custom hooks override dialect defaults.
 *
 * Example (SQLite with dialect):
 * ```ts
 * await db.run('CREATE TABLE todos (id TEXT PRIMARY KEY, todo_title TEXT, is_done INTEGER)');
 * const adapter = createCustomMaterializer({
 *   db: myDb,
 *   dialect: 'sqlite',
 *   tableMap: { todos: 'todos' },
 *   fieldMap: { todos: { title: 'todo_title', done: 'is_done' } }
 * });
 * ```
 *
 * Example (PostgreSQL with dialect):
 * ```ts
 * const adapter = createCustomMaterializer({
 *   db: myDb, // must handle $1, $2, etc. in run()/get()
 *   dialect: 'postgresql',
 *   tableMap: { todos: 'todos' }
 * });
 * ```
 *
 * Example (Custom hooks):
 * ```ts
 * const adapter = createCustomMaterializer({
 *   db: myDb,
 *   tableMap: { todos: 'todos' },
 *   saveCommand: (tagsTable, entity, id, dataJson, tagsJson) => `...`
 * });
 * ```
 */
export function createCustomMaterializer<
  S extends ConvergeSchema = ConvergeSchema,
>(config: CustomMaterializerConfig<S>): MaterializerAdapter<S> {
  const tagsTable = config.tagsTable ?? 'converge_tags';

  // Resolve dialect: use provided dialect, or default to 'sqlite' if no custom hooks
  const dialectName =
    config.dialect ??
    (config.loadCommand || config.saveCommand || config.removeCommand || config.saveEntityCommand
      ? undefined
      : 'sqlite');

  const dialect = dialectName ? dialects[dialectName] : undefined;

  if (!dialect && !config.loadCommand && !config.saveCommand && !config.removeCommand) {
    throw new Error(
      'Either provide a dialect name or custom hooks (loadCommand, saveCommand, removeCommand)',
    );
  }

  // Ensure tags table exists
  const ensureTagsTable = async () => {
    if (dialect) {
      const sql = dialect.createTagsTable(tagsTable);
      await config.db.run(sql, []);
    }
    // If no dialect and no custom create, assume table exists or user handles it
  };

  // Initialize tags table on first use
  let tagsTableInitialized = false;
  const initTagsTable = async () => {
    if (!tagsTableInitialized) {
      await ensureTagsTable();
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
    if (config.loadCommand) {
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
    if (config.saveCommand) {
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
    if (config.removeCommand) {
      return config.removeCommand(tagsTable, entity, id, dataJson, tagsJson, deletedTag);
    }
    if (dialect) {
      return dialect.removeCommand(tagsTable);
    }
    throw new Error('No removeCommand provided and no dialect specified');
  };

  return {
    async load<E extends EntityName<S>>(
      entity: E,
      id: string,
    ): Promise<MaterializerState<S, E> | null> {
      await initTagsTable();
      const command = loadCommand(entity, id);
      const row = await config.db.get<TagsRow>(command, [entity, id]);

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
      const command = saveCommand(entity, id, dataJson, tagsJson);
      await config.db.run(command, [entity, id, dataJson, tagsJson]);

      // Optionally save values to actual table columns if fieldMap is provided
      if (fieldMap && Object.keys(state.values).length > 0) {
        const columns: string[] = [];
        const values: unknown[] = [];
        const updates: string[] = [];

        for (const [field, value] of Object.entries(state.values)) {
          const column = fieldMap[field] ?? field;
          columns.push(column);
          values.push(value);
          updates.push(`${column} = ?`);
        }

        if (columns.length > 0) {
          let command: string;
          let params: unknown[];

          if (config.saveEntityCommand) {
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

          await config.db.run(command, params);
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

      const command = removeCommand(entity, id, dataJson, tagsJson, deletedTag);
      await config.db.run(command, [entity, id, dataJson, tagsJson, deletedTag]);
    },
  };
}
