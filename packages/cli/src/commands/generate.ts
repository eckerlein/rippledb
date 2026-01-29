import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig } from '../utils/config-loader.js';
import { generateFromDrizzle } from './generate-drizzle.js';
import { createConsoleLogger } from '../logger.js';

export const generateCommand = new Command('generate')
  .description('Generate RippleDB schemas from external sources')
  .option('-c, --config <path>', 'Path to config file', 'ripple.config.ts')
  .option('-q, --quiet', 'Suppress informational logs', false)
  .action(async (options) => {
    const configPath = resolve(process.cwd(), options.config);

    if (!existsSync(configPath)) {
      console.error(`Config file not found: ${configPath}`);
      console.error('Create a ripple.config.ts file or specify a path with --config');
      process.exit(1);
    }

    const logger = createConsoleLogger(options.quiet ? 'test' : 'normal');
    logger.log?.(`Loading config from: ${configPath}`);
    const config = await loadConfig(configPath);

    if (!config.codegen) {
      console.error('No codegen configuration found in config file');
      process.exit(1);
    }

    const { codegen } = config;
    if (codegen.drizzle) {
      logger.log?.('Generating RippleDB schema from Drizzle...');
      await generateFromDrizzle(codegen.drizzle, process.cwd(), { logger });
      logger.log?.('Done!');
    } else {
      console.error('No codegen source configured. Add drizzle config to codegen section.');
      process.exit(1);
    }
  });
