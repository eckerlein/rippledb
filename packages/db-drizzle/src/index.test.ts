import {
  type Change,
  createHlcState,
  defineSchema,
  makeUpsert,
  s,
  tickHlc,
} from "@rippledb/core";
import { createDrizzleSyncMaterializer } from "@rippledb/materialize-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  getTableConfig,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleDb } from "./index";

type TestSchema = {
  todos: {
    id: string;
    title: string;
    done: boolean;
  };
};

const schema = defineSchema({
  todos: {
    id: s.string(),
    title: s.string(),
    done: s.boolean(),
  },
});

// Define Drizzle tables for the internal ripple tables
// Note: Composite primary keys are defined in the raw SQL, not in the Drizzle schema
const changesTable = sqliteTable("ripple_changes", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  stream: text("stream").notNull(),
  change_json: text("change_json").notNull(),
});

const idempotencyTable = sqliteTable("ripple_idempotency", {
  stream: text("stream").notNull(),
  idempotency_key: text("idempotency_key").notNull(),
  last_seq: integer("last_seq").notNull(),
});

// Tags table for materialization tests
const tagsTable = sqliteTable("ripple_tags", {
  entity: text("entity").notNull(),
  id: text("id").notNull(),
  data: text("data").notNull(),
  tags: text("tags").notNull(),
  deleted: integer("deleted").notNull().default(0),
  deleted_tag: text("deleted_tag"),
});

const todosTable = sqliteTable("todos", {
  id: text("id").primaryKey(),
  title: text("title"),
  done: integer("done"),
});

describe("DrizzleDb with SQLite", () => {
  let dbPath: string;
  let sqlite: InstanceType<typeof Database>;

  beforeEach(() => {
    dbPath = join(
      tmpdir(),
      `test-drizzle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    sqlite = new Database(dbPath);

    // Create internal tables (user's responsibility in production)
    sqlite.exec(`
      CREATE TABLE ripple_changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        stream TEXT NOT NULL,
        change_json TEXT NOT NULL
      );
      CREATE TABLE ripple_idempotency (
        stream TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        last_seq INTEGER NOT NULL,
        PRIMARY KEY (stream, idempotency_key)
      );
    `);
  });

  afterEach(() => {
    try {
      sqlite.close();
      unlinkSync(dbPath);
    } catch {
      // ignore cleanup errors
    }
  });

  it("appends and pulls changes", async () => {
    const db = drizzle(sqlite);
    const rippleDb = new DrizzleDb<TestSchema>({
      db,
      changesTable,
      idempotencyTable,
      getTableConfig,
      isSync: true,
      schema,
    });

    const hlc = tickHlc(createHlcState("node-1"), 100);
    const change = makeUpsert<TestSchema>({
      stream: "test",
      entity: "todos",
      entityId: "todo-1",
      patch: { id: "todo-1", title: "Buy milk", done: false },
      hlc,
    });

    const appendResult = await rippleDb.append({
      stream: "test",
      changes: [change],
    });
    expect(appendResult.accepted).toBe(1);

    const pullResult = await rippleDb.pull({ stream: "test", cursor: null });
    expect(pullResult.changes).toHaveLength(1);
    expect(pullResult.changes[0]).toEqual(change);
    expect(pullResult.nextCursor).toBe("1");

    rippleDb.close();
  });

  it("handles idempotency keys", async () => {
    const db = drizzle(sqlite);
    const rippleDb = new DrizzleDb<TestSchema>({
      db,
      changesTable,
      idempotencyTable,
      getTableConfig,
      isSync: true,
      schema,
    });

    const hlc = tickHlc(createHlcState("node-1"), 100);
    const change = makeUpsert<TestSchema>({
      stream: "test",
      entity: "todos",
      entityId: "todo-1",
      patch: { id: "todo-1", title: "Buy milk", done: false },
      hlc,
    });

    // First append should succeed
    const result1 = await rippleDb.append({
      stream: "test",
      changes: [change],
      idempotencyKey: "key-1",
    });
    expect(result1.accepted).toBe(1);

    // Second append with same key should be rejected
    const result2 = await rippleDb.append({
      stream: "test",
      changes: [change],
      idempotencyKey: "key-1",
    });
    expect(result2.accepted).toBe(0);

    // Different key should succeed
    const result3 = await rippleDb.append({
      stream: "test",
      changes: [change],
      idempotencyKey: "key-2",
    });
    expect(result3.accepted).toBe(1);

    rippleDb.close();
  });

  it("supports cursor-based pagination", async () => {
    const db = drizzle(sqlite);
    const rippleDb = new DrizzleDb<TestSchema>({
      db,
      changesTable,
      idempotencyTable,
      getTableConfig,
      isSync: true,
      schema,
    });

    // Insert multiple changes
    const changes: Change<TestSchema>[] = [];
    for (let i = 0; i < 5; i++) {
      const hlc = tickHlc(createHlcState("node-1"), 100 + i);
      changes.push(
        makeUpsert<TestSchema>({
          stream: "test",
          entity: "todos",
          entityId: `todo-${i}`,
          patch: { id: `todo-${i}`, title: `Task ${i}`, done: false },
          hlc,
        }),
      );
    }

    await rippleDb.append({ stream: "test", changes });

    // Pull with limit
    const page1 = await rippleDb.pull({
      stream: "test",
      cursor: null,
      limit: 2,
    });
    expect(page1.changes).toHaveLength(2);
    expect(page1.nextCursor).toBe("2");

    // Pull next page
    const page2 = await rippleDb.pull({
      stream: "test",
      cursor: page1.nextCursor,
      limit: 2,
    });
    expect(page2.changes).toHaveLength(2);
    expect(page2.nextCursor).toBe("4");

    // Pull remaining
    const page3 = await rippleDb.pull({
      stream: "test",
      cursor: page2.nextCursor,
      limit: 2,
    });
    expect(page3.changes).toHaveLength(1);
    expect(page3.nextCursor).toBe("5");

    rippleDb.close();
  });

  it("supports materialization with Drizzle executor", async () => {
    // Create entity + tags tables
    sqlite.exec(`
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT,
        done INTEGER
      );
      CREATE TABLE ripple_tags (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        tags TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        deleted_tag TEXT,
        PRIMARY KEY (entity, id)
      );
    `);

    const db = drizzle(sqlite);
    const rippleDb = new DrizzleDb<TestSchema, typeof db>({
      db,
      changesTable,
      idempotencyTable,
      getTableConfig,
      isSync: true,
      schema,
      materializer: ({ schema: schemaDescriptor }) =>
        createDrizzleSyncMaterializer({
          schema: schemaDescriptor,
          tableMap: { todos: todosTable },
          tagsTableDef: tagsTable,
          getTableConfig,
          fieldMap: { todos: { id: "id", title: "title", done: "done" } },
          normalizeValue: (value: unknown) =>
            typeof value === "boolean" ? (value ? 1 : 0) : value,
        }),
    });

    const hlc = tickHlc(createHlcState("node-1"), 100);
    const change = makeUpsert<TestSchema>({
      stream: "test",
      entity: "todos",
      entityId: "todo-1",
      patch: { id: "todo-1", title: "Buy milk", done: false },
      hlc,
    });

    await rippleDb.append({ stream: "test", changes: [change] });

    // Verify materialized data
    const tagsRow = sqlite
      .prepare(
        "SELECT data, tags, deleted FROM ripple_tags WHERE entity = ? AND id = ?",
      )
      .get("todos", "todo-1") as {
      data: string;
      tags: string;
      deleted: number;
    };

    expect(tagsRow).toBeTruthy();
    expect(JSON.parse(tagsRow.data)).toEqual({
      id: "todo-1",
      title: "Buy milk",
      done: false,
    });
    expect(tagsRow.deleted).toBe(0);

    rippleDb.close();
  });

  it("rolls back transaction on error (atomicity)", async () => {
    // Create domain table with CHECK constraint and tags table
    sqlite.exec(`
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT,
        done INTEGER CHECK (done IN (0, 1))
      );
      CREATE TABLE ripple_tags (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        tags TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        deleted_tag TEXT,
        PRIMARY KEY (entity, id)
      );
    `);

    const db = drizzle(sqlite);
    const rippleDb = new DrizzleDb<TestSchema, typeof db>({
      db,
      changesTable,
      idempotencyTable,
      getTableConfig,
      isSync: true,
      schema,
      materializer: ({ schema: schemaDescriptor }) =>
        createDrizzleSyncMaterializer({
          schema: schemaDescriptor,
          tableMap: { todos: todosTable },
          tagsTableDef: tagsTable,
          getTableConfig,
          fieldMap: { todos: { id: "id", title: "title", done: "done" } },
          normalizeValue: (value: unknown) =>
            typeof value === "boolean" ? (value ? 1 : 0) : value,
        }),
    });

    // Create a change with done: 2 which violates CHECK (done IN (0, 1)) constraint
    const invalidChange = {
      ...makeUpsert<TestSchema>({
        stream: "test",
        entity: "todos",
        entityId: "todo-1",
        patch: { id: "todo-1", title: "Buy milk", done: false },
        hlc: tickHlc(createHlcState("node-1"), 100),
      }),
      patch: { id: "todo-1", title: "Buy milk", done: 2 }, // Violates CHECK constraint
    } as unknown as Change<TestSchema>;

    // Append should fail due to CHECK constraint
    await expect(
      rippleDb.append({ stream: "test", changes: [invalidChange] }),
    ).rejects.toThrow();

    // Verify no changes were persisted (transaction rolled back)
    const changeCount = sqlite
      .prepare("SELECT COUNT(*) as count FROM ripple_changes")
      .get() as { count: number };
    expect(changeCount.count).toBe(0);

    // Verify no tags were persisted
    const tagsCount = sqlite
      .prepare("SELECT COUNT(*) as count FROM ripple_tags")
      .get() as { count: number };
    expect(tagsCount.count).toBe(0);

    rippleDb.close();
  });
});
