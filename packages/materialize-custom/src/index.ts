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
