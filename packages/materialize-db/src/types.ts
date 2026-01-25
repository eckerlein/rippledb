import type { ConvergeSchema, EntityName } from '@converge/core';

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
 * Base configuration shared by all materialization adapters.
 */
type BaseMaterializerConfig<S extends ConvergeSchema> = {
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
};

/**
 * Configuration when using a built-in dialect.
 */
type DialectConfig<S extends ConvergeSchema> = BaseMaterializerConfig<S> & {
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
type CustomCommandsConfig<S extends ConvergeSchema> = BaseMaterializerConfig<S> & {
  dialect?: never;
  /**
   * Custom command for loading entity state.
   * Receives: (tagsTable, entity, id) and should return command with placeholders.
   */
  loadCommand: (tagsTable: string, entity: string, id: string) => string;

  /**
   * Custom command for saving entity state.
   * Receives: (tagsTable, entity, id, dataJson, tagsJson) and should return command with placeholders.
   */
  saveCommand: (
    tagsTable: string,
    entity: string,
    id: string,
    dataJson: string,
    tagsJson: string,
  ) => string;

  /**
   * Custom command for removing (tombstoning) entity state.
   * Receives: (tagsTable, entity, id, dataJson, tagsJson, deletedTag) and should return command with placeholders.
   */
  removeCommand: (
    tagsTable: string,
    entity: string,
    id: string,
    dataJson: string,
    tagsJson: string,
    deletedTag: string,
  ) => string;

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
 * Configuration for custom materialization adapter.
 * Either provide a dialect name OR all custom commands (loadCommand, saveCommand, removeCommand).
 */
export type CustomMaterializerConfig<
  S extends ConvergeSchema = ConvergeSchema,
> = DialectConfig<S> | CustomCommandsConfig<S>;

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
