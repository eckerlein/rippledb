#!/usr/bin/env node

import { Command } from 'commander';
import { generateCommand } from './commands/generate.js';

const program = new Command();

program
  .name('rippledb')
  .description('CLI tools for RippleDB')
  .version('0.0.1');

program.addCommand(generateCommand);

program.parse();
