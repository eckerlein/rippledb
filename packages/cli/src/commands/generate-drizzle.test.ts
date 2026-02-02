import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createConsoleLogger } from "../logger.js";
import { loadConfig } from "../utils/config-loader.js";
import { generateFromDrizzle } from "./generate-drizzle.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "rippledb-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadConfig rejects invalid drizzle configuration", async () => {
  await withTempDir(async dir => {
    const path = join(dir, "bad-config.ts");
    await writeFile(
      path,
      "export default { codegen: { drizzle: { entities: null, output: 123 } } };",
    );
    await expect(loadConfig(path)).rejects.toThrow(/Invalid RippleDB config/);
  });
});

test("loadConfig parses valid configuration", async () => {
  await withTempDir(async dir => {
    const path = join(dir, "good-config.ts");
    await writeFile(
      path,
      `
export default {
  codegen: {
    drizzle: {
      entities: './src/db/ripple-entities.ts',
      output: './src/shared/schema.ts',
    },
  },
};
`,
    );
    const config = await loadConfig(path);
    expect(config.codegen?.drizzle).toEqual({
      entities: "./src/db/ripple-entities.ts",
      output: "./src/shared/schema.ts",
    });
  });
});

test("generateFromDrizzle writes schema file with table definitions", async () => {
  await withTempDir(async dir => {
    const entitiesPath = join(dir, "entities.ts");
    await writeFile(
      entitiesPath,
      `
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const todos = sqliteTable('todos', {
  id: text('id').primaryKey(),
  title: text('title'),
});
`,
    );
    const outputPath = join(dir, "schema.ts");

    await generateFromDrizzle(
      {
        entities: entitiesPath,
        output: outputPath,
      },
      dir,
      {
        logger: createConsoleLogger("test"),
      },
    );

    const generated = await readFile(outputPath, "utf-8");
    expect(generated).toContain("todos");
    expect(generated).toContain("defineSchema");
  });
});
