#!/usr/bin/env node

import { Command } from "commander";
import { createRequire } from "node:module";
import { generateCommand } from "./commands/generate.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

const program = new Command();

program
  .name("rippledb")
  .description("CLI tools for RippleDB")
  .version(packageJson.version);

program.addCommand(generateCommand);

program.parse();
