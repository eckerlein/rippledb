import type { RippleConfig } from '../config.js';
import { object, optional, parse, string } from 'valibot';

const drizzleSchema = object({
  entities: string(),
  output: string(),
});

const codegenSchema = object({
  drizzle: optional(drizzleSchema),
});

const rippleConfigSchema = object({
  codegen: optional(codegenSchema),
});

function validateConfig(value: unknown, configPath: string): RippleConfig {
  try {
    return parse(rippleConfigSchema, value);
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Invalid RippleDB config (${configPath}): ${err.message}`);
    }
    throw err;
  }
}

/**
 * Load and parse a RippleDB config file
 */
export async function loadConfig(configPath: string): Promise<RippleConfig> {
  // Use jiti for TypeScript config file support
  const { createJiti } = await import('jiti');
  const jiti = createJiti(process.cwd());

  try {
    const configModule = await jiti.import(configPath) as { default?: RippleConfig } | RippleConfig;

    // Handle both default export and named export
    const config = 'default' in configModule ? configModule.default : configModule;

    if (!config) {
      throw new Error('Config file must export a configuration object');
    }

    return validateConfig(config, configPath);
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Failed to load config from ${configPath}: ${err.message}`);
    }
    throw err;
  }
}
