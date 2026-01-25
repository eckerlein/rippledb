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
 * Maps schema field names to SQL column names.
 */
export type EntityFieldMap = Record<string, string>;

/**
 * Configuration for custom materialization adapter.
 * Works with any database by providing custom query/command strings.
 */
export type CustomMaterializerConfig<
  S extends ConvergeSchema = ConvergeSchema,
> = {
  /**
   * Database instance. Can be SQL, MongoDB, DynamoDB, etc.
   */
  db: Db;

  /**
   * Table name for storing entity tags/metadata.
   * Default: 'converge_tags'
   */
  tagsTable?: string;

  /**
   * Map entity names to their SQL table names.
   * These tables must already exist in your database.
   */
  tableMap: Record<EntityName<S>, string>;

  /**
   * Map entity names to their field-to-column mappings.
   * If omitted, field names are used as column names.
   * The columns must already exist in the corresponding tables.
   */
  fieldMap?: Partial<Record<EntityName<S>, EntityFieldMap>>;

  /**
   * Custom SQL for loading entity state.
   * Receives: (tableName, id) and should return columns: id, data (JSON), tags (JSON), deleted (0/1), deleted_tag (TEXT or NULL)
   * If omitted, uses default pattern.
   */
  loadSql?: (tableName: string, id: string) => string;

  /**
   * Custom SQL for saving entity state.
   * Receives: (tableName, id, dataJson, tagsJson) and should handle INSERT ... ON CONFLICT DO UPDATE.
   * If omitted, uses default pattern.
   */
  saveSql?: (
    tableName: string,
    id: string,
    dataJson: string,
    tagsJson: string,
  ) => string;

  /**
   * Custom SQL for removing (tombstoning) entity state.
   * Receives: (tableName, id, dataJson, tagsJson, deletedTag) and should handle INSERT ... ON CONFLICT DO UPDATE.
   * If omitted, uses default pattern.
   */
  removeSql?: (
    tableName: string,
    id: string,
    dataJson: string,
    tagsJson: string,
    deletedTag: string,
  ) => string;

  /**
   * Custom SQL for saving entity values to actual table columns (when fieldMap is provided).
   * Receives: (tableName, id, columns, values, updates) where:
   * - columns: array of column names
   * - values: array of values (same length as columns)
   * - updates: array of "column = ?" strings for UPDATE clause
   * If omitted, uses SQLite-compatible INSERT ... ON CONFLICT DO UPDATE pattern.
   */
  saveEntitySql?: (
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
 * This adapter works with any database by letting you provide custom
 * query/command strings. It stores entity values in actual database
 * structures (via fieldMap) and stores tags/metadata separately.
 *
 * **Important:**
 * - Entity tables/collections (e.g., `todos`, `users`) must already exist.
 *   The materializer does NOT create or maintain them.
 * - Entity structures only need data fields. They do NOT need tag fields.
 *   Tags are stored separately in a tags table/collection.
 * - The tags table/collection is auto-created on first use (via default SQL).
 *   For non-SQL databases, provide custom `saveSql`/`removeSql` hooks.
 * - The materializer assumes entity structures match the schema defined by
 *   `tableMap` and `fieldMap`.
 * - **Default implementations are SQLite-compatible** (`ON CONFLICT ... DO UPDATE`).
 *   For other databases, provide custom hooks (`saveSql`/`removeSql`/`saveEntitySql`).
 *
 * Example (SQLite):
 * ```ts
 * await db.run('CREATE TABLE todos (id TEXT PRIMARY KEY, todo_title TEXT, is_done INTEGER)');
 * const adapter = createCustomMaterializer({
 *   db: myDb,
 *   tableMap: { todos: 'todos' },
 *   fieldMap: { todos: { title: 'todo_title', done: 'is_done' } }
 * });
 * ```
 *
 * Example (PostgreSQL):
 * ```ts
 * const adapter = createCustomMaterializer({
 *   db: myDb, // must map ? to $1, $2, etc. in run()/get()
 *   tableMap: { todos: 'todos' },
 *   saveSql: (table, id, dataJson, tagsJson) =>
 *     `INSERT INTO converge_tags (entity, id, data, tags, deleted, deleted_tag)
 *      VALUES (?, ?, ?, ?, 0, NULL)
 *      ON CONFLICT (entity, id) DO UPDATE SET ...`
 * });
 * ```
 */
export function createCustomMaterializer<
  S extends ConvergeSchema = ConvergeSchema,
>(config: CustomMaterializerConfig<S>): MaterializerAdapter<S> {
  const tagsTable = config.tagsTable ?? 'converge_tags';

  // Ensure tags table exists
  const ensureTagsTable = async () => {
    await config.db.run(
      `CREATE TABLE IF NOT EXISTS ${tagsTable} (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        tags TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        deleted_tag TEXT,
        PRIMARY KEY (entity, id)
      )`,
      [],
    );
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

  const loadSql = (tableName: string, id: string): string => {
    if (config.loadSql) {
      return config.loadSql(tableName, id);
    }
    // Default: load from tags table
    return `SELECT data, tags, deleted, deleted_tag FROM ${tagsTable} WHERE entity = ? AND id = ?`;
  };

  const saveSql = (
    tableName: string,
    id: string,
    dataJson: string,
    tagsJson: string,
  ): string => {
    if (config.saveSql) {
      return config.saveSql(tableName, id, dataJson, tagsJson);
    }
    // Default: upsert into tags table
    return `INSERT INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag)
            VALUES (?, ?, ?, ?, 0, NULL)
            ON CONFLICT(entity, id) DO UPDATE SET
              data = excluded.data,
              tags = excluded.tags,
              deleted = 0,
              deleted_tag = NULL`;
  };

  const removeSql = (
    tableName: string,
    id: string,
    dataJson: string,
    tagsJson: string,
    deletedTag: string,
  ): string => {
    if (config.removeSql) {
      return config.removeSql(tableName, id, dataJson, tagsJson, deletedTag);
    }
    // Default: upsert into tags table with deleted flag
    return `INSERT INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag)
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT(entity, id) DO UPDATE SET
              data = excluded.data,
              tags = excluded.tags,
              deleted = 1,
              deleted_tag = excluded.deleted_tag`;
  };

  return {
    async load<E extends EntityName<S>>(
      entity: E,
      id: string,
    ): Promise<MaterializerState<S, E> | null> {
      await initTagsTable();
      const tableName = getTableName(entity);
      const sql = loadSql(tableName, id);
      const row = await config.db.get<TagsRow>(sql, [entity, id]);

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
      const sql = saveSql(tableName, id, dataJson, tagsJson);
      await config.db.run(sql, [entity, id, dataJson, tagsJson]);

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
          let sql: string;
          let params: unknown[];

          if (config.saveEntitySql) {
            const result = config.saveEntitySql(tableName, id, columns, values, updates);
            sql = result.sql;
            params = result.params;
          } else {
            // Default: SQLite-compatible INSERT ... ON CONFLICT DO UPDATE
            sql = `INSERT INTO ${tableName} (id, ${columns.join(', ')})
                   VALUES (?, ${columns.map(() => '?').join(', ')})
                   ON CONFLICT(id) DO UPDATE SET
                     ${updates.join(', ')}`;
            params = [id, ...values, ...values];
          }

          await config.db.run(sql, params);
        }
      }
    },

    async remove<E extends EntityName<S>>(
      entity: E,
      id: string,
      state: MaterializerState<S, E>,
    ): Promise<void> {
      await initTagsTable();
      const tableName = getTableName(entity);
      const dataJson = JSON.stringify(state.values);
      const tagsJson = JSON.stringify(state.tags);
      const deletedTag = state.deletedTag ?? '';

      const sql = removeSql(tableName, id, dataJson, tagsJson, deletedTag);
      await config.db.run(sql, [entity, id, dataJson, tagsJson, deletedTag]);
    },
  };
}
