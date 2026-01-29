import type { RippleConfig } from '../config.js';

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

    return config as RippleConfig;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Failed to load config from ${configPath}: ${err.message}`);
    }
    throw err;
  }
}
