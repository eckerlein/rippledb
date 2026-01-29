/**
 * Configuration types and helpers for RippleDB CLI
 */

/**
 * Drizzle codegen configuration
 */
export interface DrizzleCodegenConfig {
  /**
   * Path to the file that exports Drizzle tables to include in RippleDB schema.
   * This file should export the tables you want to use as RippleDB entities.
   * 
   * @example './src/db/ripple-entities.ts'
   */
  entities: string;

  /**
   * Output path for the generated RippleDB schema file.
   * 
   * @example './src/shared/schema.ts'
   */
  output: string;
}

/**
 * Codegen configuration
 */
export interface CodegenConfig {
  /**
   * Generate RippleDB schema from Drizzle tables
   */
  drizzle?: DrizzleCodegenConfig;
}

/**
 * RippleDB CLI configuration
 */
export interface RippleConfig {
  /**
   * Schema codegen configuration
   */
  codegen?: CodegenConfig;
}

/**
 * Define a type-safe RippleDB configuration.
 * Use this in your `ripple.config.ts` file.
 * 
 * @example
 * ```ts
 * // ripple.config.ts
 * import { defineConfig } from '@rippledb/cli/config';
 * 
 * export default defineConfig({
 *   codegen: {
 *     drizzle: {
 *       entities: './src/db/ripple-entities.ts',
 *       output: './src/shared/schema.ts',
 *     },
 *   },
 * });
 * ```
 */
export function defineConfig(config: RippleConfig): RippleConfig {
  return config;
}
