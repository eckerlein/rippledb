// Re-export types
export type {
  CustomMaterializerConfig,
  Db,
  Dialect,
  EntityFieldMap,
  MaterializerConfigBase,
  MaterializerExecutor,
  SqlMaterializerConfig,
  TagsRow,
} from "./types";

// Re-export dialects
export { dialects } from "./dialects";

// Re-export main functions
export { createMaterializer, createSqlExecutor } from "./adapter";

// Re-export sync adapter for SQLite
export { createSyncMaterializer, createSyncSqlExecutor } from "./sync-adapter";
export type {
  SyncMaterializerAdapter,
  SyncMaterializerExecutor,
} from "./sync-adapter";
