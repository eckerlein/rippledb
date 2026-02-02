import type { EntityName, MaterializerDb, RippleSchema } from "@rippledb/core";

/**
 * @deprecated Use MaterializerDb from @rippledb/core instead
 * Kept for backward compatibility during migration
 */
export type Db = MaterializerDb;

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
 * Base configuration shared by all materialization adapters.
 */
export type MaterializerConfigBase<S extends RippleSchema> = {
  /**
   * Table/collection name for storing entity tags/metadata.
   * Default: 'ripple_tags'
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
};

/**
 * Executor for materialization operations.
 *
 * Executors are stateless - they receive the transaction-bound database instance
 * as the first parameter to all methods. This allows executors to be created once
 * and reused across transactions.
 */
export type MaterializerExecutor = {
  /**
   * Ensure tags table/collection exists. Optional.
   * Receives the transaction-bound database instance.
   */
  ensureTagsTable?: (db: MaterializerDb) => Promise<void>;

  /**
   * Load tags row for a specific entity + id.
   * Receives the transaction-bound database instance as first parameter.
   */
  loadTags: (
    db: MaterializerDb,
    entity: string,
    id: string,
  ) => Promise<TagsRow | null>;

  /**
   * Save tags row for a specific entity + id.
   * Receives the transaction-bound database instance as first parameter.
   */
  saveTags: (
    db: MaterializerDb,
    entity: string,
    id: string,
    dataJson: string,
    tagsJson: string,
  ) => Promise<void>;

  /**
   * Remove (tombstone) tags row for a specific entity + id.
   * Receives the transaction-bound database instance as first parameter.
   */
  removeTags: (
    db: MaterializerDb,
    entity: string,
    id: string,
    dataJson: string,
    tagsJson: string,
    deletedTag: string,
  ) => Promise<void>;

  /**
   * Save entity values to the domain table/collection (when fieldMap is provided).
   * Receives the transaction-bound database instance as first parameter.
   */
  saveEntity?: (
    db: MaterializerDb,
    tableName: string,
    id: string,
    columns: string[],
    values: unknown[],
    updates: string[],
  ) => Promise<void>;
};

/**
 * Configuration when using a built-in dialect.
 */
type DialectConfig<S extends RippleSchema> = MaterializerConfigBase<S> & {
  /**
   * Database dialect name (e.g., 'sqlite', 'postgresql').
   */
  dialect: string;
  loadCommand?: never;
  saveCommand?: never;
  removeCommand?: never;
  saveEntityCommand?: (
    tableName: string,
    id: string,
    columns: string[],
    values: unknown[],
    updates: string[],
  ) => { sql: string; params: unknown[] };
};

/**
 * Configuration when providing all custom commands.
 */
type CustomCommandsConfig<S extends RippleSchema> =
  MaterializerConfigBase<S> & {
    dialect?: never;
    /**
     * Custom command for loading entity state.
     * Receives: (tagsTable) and should return command with placeholders for entity and id.
     * The command should return columns: data, tags, deleted, deleted_tag
     */
    loadCommand: (tagsTable: string) => string;

    /**
     * Custom command for saving entity state.
     * Receives: (tagsTable) and should return command with placeholders for entity, id, dataJson, tagsJson.
     * Should handle upsert.
     */
    saveCommand: (tagsTable: string) => string;

    /**
     * Custom command for removing (tombstoning) entity state.
     * Receives: (tagsTable) and should return command with placeholders for entity, id, dataJson, tagsJson, deletedTag.
     * Should handle upsert with deleted flag.
     */
    removeCommand: (tagsTable: string) => string;

    /**
     * Custom command for saving entity values to actual table columns (when fieldMap is provided).
     * Required if fieldMap is used, optional otherwise.
     */
    saveEntityCommand?: (
      tableName: string,
      id: string,
      columns: string[],
      values: unknown[],
      updates: string[],
    ) => { sql: string; params: unknown[] };
  };

/**
 * Configuration when providing a custom executor.
 */
type ExecutorConfig<S extends RippleSchema> = MaterializerConfigBase<S> & {
  executor: MaterializerExecutor;
  dialect?: never;
  loadCommand?: never;
  saveCommand?: never;
  removeCommand?: never;
  saveEntityCommand?: never;
};

/**
 * Configuration for custom materialization adapter.
 * Either provide a dialect name OR all custom commands (loadCommand, saveCommand, removeCommand).
 */
export type SqlMaterializerConfig<S extends RippleSchema = RippleSchema> =
  | DialectConfig<S>
  | CustomCommandsConfig<S>;

export type CustomMaterializerConfig<S extends RippleSchema = RippleSchema> =
  ExecutorConfig<S>;

/**
 * Internal type for tags table row structure.
 */
export type TagsRow = {
  id: string;
  data: string;
  tags: string;
  deleted: number;
  deleted_tag: string | null;
};
