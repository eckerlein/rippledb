// Re-export types
export type {
  CustomMaterializerConfig,
  Db,
  Dialect,
  EntityFieldMap,
} from './types';

// Re-export dialects
export { dialects } from './dialects';

// Re-export main function
export { createCustomMaterializer } from './adapter';

// Re-export sync adapter for SQLite
export { createSyncMaterializer } from './sync-adapter';
export type { SyncMaterializerAdapter } from './sync-adapter';
