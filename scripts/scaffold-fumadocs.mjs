import { create } from "create-fumadocs-app";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "apps", "docs");

if (fs.existsSync(outputDir)) {
  console.error(`Refusing to overwrite existing directory: ${outputDir}`);
  process.exit(1);
}

await create({
  outputDir,
  template: "+next+fuma-docs-mdx",
  packageManager: "pnpm",
});

