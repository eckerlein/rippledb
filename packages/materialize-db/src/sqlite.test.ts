import {
  createHlcState,
  defineSchema,
  makeDelete,
  makeUpsert,
  s,
  tickHlc,
} from "@rippledb/core";
import {
  materializeChange,
  materializeChanges,
  type MaterializerAdapter,
} from "@rippledb/materialize-core";
import { beforeEach, describe, expect, it } from "vitest";
import { createMaterializer } from "./adapter";
import { createSqliteDb, type TestSchema } from "./test-helpers";
import type { Db } from "./types";

describe("createMaterializer - SQLite dialect", () => {
  let db: Db;
  let adapter: MaterializerAdapter<TestSchema>;
  const schema = defineSchema({
    todos: {
      id: s.string(),
      title: s.string(),
      done: s.boolean(),
    },
  });

  beforeEach(async () => {
    db = createSqliteDb();
    // Create entity table
    await db.run(
      "CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER)",
      [],
    );
    adapter = createMaterializer({
      schema,
      db,
      dialect: "sqlite",
      tableMap: { todos: "todos" },
    });
  });

  it("creates tags table on first use", async () => {
    const hlc = tickHlc(createHlcState("node-1"), 100);
    const change = makeUpsert<TestSchema>({
      stream: "test",
      entity: "todos",
      entityId: "todo-1",
      patch: { id: "todo-1", title: "Buy milk", done: false },
      hlc,
    });

    await materializeChange(adapter, db, change);

    // Verify tags table exists and has data
    const row = await db.get<{ data: string; tags: string; deleted: number }>(
      "SELECT data, tags, deleted FROM ripple_tags WHERE entity = ? AND id = ?",
      ["todos", "todo-1"],
    );
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.data)).toEqual({
      id: "todo-1",
      title: "Buy milk",
      done: false,
    });
    expect(row!.deleted).toBe(0);
  });

  it("saves entity to both tags table and entity table", async () => {
    const adapterWithFieldMap = createMaterializer({
      schema,
      db,
      dialect: "sqlite",
      tableMap: { todos: "todos" },
      fieldMap: { todos: { id: "id", title: "title", done: "done" } },
    });

    const hlc = tickHlc(createHlcState("node-1"), 100);
    const change = makeUpsert<TestSchema>({
      stream: "test",
      entity: "todos",
      entityId: "todo-1",
      patch: { id: "todo-1", title: "Buy milk", done: false },
      hlc,
    });

    await materializeChange(adapterWithFieldMap, db, change);

    // Check entity table
    const entityRow = await db.get<{ id: string; title: string; done: number }>(
      "SELECT id, title, done FROM todos WHERE id = ?",
      ["todo-1"],
    );
    expect(entityRow).toEqual({ id: "todo-1", title: "Buy milk", done: 0 });
  });

  it("uses field mapping when provided", async () => {
    const db2 = createSqliteDb();
    await db2.run(
      "CREATE TABLE todos (id TEXT PRIMARY KEY, todo_title TEXT, is_done INTEGER)",
      [],
    );
    const adapter2 = createMaterializer({
      schema,
      db: db2,
      dialect: "sqlite",
      tableMap: { todos: "todos" },
      fieldMap: { todos: { id: "id", title: "todo_title", done: "is_done" } },
    });

    const hlc = tickHlc(createHlcState("node-1"), 100);
    const change = makeUpsert<TestSchema>({
      stream: "test",
      entity: "todos",
      entityId: "todo-1",
      patch: { id: "todo-1", title: "Buy milk", done: false },
      hlc,
    });

    await materializeChange(adapter2, db2, change);

    const row = await db2.get<{
      id: string;
      todo_title: string;
      is_done: number;
    }>("SELECT id, todo_title, is_done FROM todos WHERE id = ?", ["todo-1"]);
    expect(row).toEqual({ id: "todo-1", todo_title: "Buy milk", is_done: 0 });
  });

  it("loads existing state", async () => {
    const hlc1 = tickHlc(createHlcState("node-1"), 100);
    const change1 = makeUpsert<TestSchema>({
      stream: "test",
      entity: "todos",
      entityId: "todo-1",
      patch: { id: "todo-1", title: "Buy milk", done: false },
      hlc: hlc1,
    });
    await materializeChange(adapter, db, change1);

    const state = await adapter.load(db, "todos", "todo-1");
    expect(state).toBeTruthy();
    expect(state!.values).toEqual({
      id: "todo-1",
      title: "Buy milk",
      done: false,
    });
    expect(state!.tags.title).toBe(hlc1);
    expect(state!.deleted).toBe(false);
  });

  it("handles deletes", async () => {
    const hlc1 = tickHlc(createHlcState("node-1"), 100);
    const change1 = makeUpsert<TestSchema>({
      stream: "test",
      entity: "todos",
      entityId: "todo-1",
      patch: { id: "todo-1", title: "Buy milk", done: false },
      hlc: hlc1,
    });
    await materializeChange(adapter, db, change1);

    const hlc2 = tickHlc(createHlcState("node-1"), 101);
    const change2 = makeDelete<TestSchema>({
      stream: "test",
      entity: "todos",
      entityId: "todo-1",
      hlc: hlc2,
    });
    const result = await materializeChange(adapter, db, change2);
    expect(result).toBe("removed");

    const state = await adapter.load(db, "todos", "todo-1");
    expect(state).toBeTruthy();
    expect(state!.deleted).toBe(true);
    expect(state!.deletedTag).toBe(hlc2);
  });

  it("handles multiple changes", async () => {
    const hlc1 = tickHlc(createHlcState("node-1"), 100);
    const hlc2 = tickHlc(createHlcState("node-1"), 101);
    const hlc3 = tickHlc(createHlcState("node-1"), 102);

    const changes = [
      makeUpsert<TestSchema>({
        stream: "test",
        entity: "todos",
        entityId: "todo-1",
        patch: { id: "todo-1", title: "Buy milk", done: false },
        hlc: hlc1,
      }),
      makeUpsert<TestSchema>({
        stream: "test",
        entity: "todos",
        entityId: "todo-1",
        patch: { done: true },
        hlc: hlc2,
      }),
      makeUpsert<TestSchema>({
        stream: "test",
        entity: "todos",
        entityId: "todo-2",
        patch: { id: "todo-2", title: "Buy bread", done: false },
        hlc: hlc3,
      }),
    ];

    await materializeChanges(adapter, db, changes);

    const state1 = await adapter.load(db, "todos", "todo-1");
    expect(state1!.values).toEqual({
      id: "todo-1",
      title: "Buy milk",
      done: true,
    });

    const state2 = await adapter.load(db, "todos", "todo-2");
    expect(state2!.values).toEqual({
      id: "todo-2",
      title: "Buy bread",
      done: false,
    });
  });

  it("uses schema-derived table mapping when tableMap is empty", async () => {
    const adapter = createMaterializer({
      schema,
      db,
      dialect: "sqlite",
      tableMap: {} as Record<keyof TestSchema, string>,
    });

    const hlc = tickHlc(createHlcState("node-1"), 100);
    const change = makeUpsert<TestSchema>({
      stream: "test",
      entity: "todos",
      entityId: "todo-1",
      patch: { id: "todo-1", title: "Buy milk", done: false },
      hlc,
    });

    await expect(materializeChange(adapter, db, change)).resolves.toBe("saved");
  });

  it("throws error for invalid dialect", () => {
    expect(() => {
      createMaterializer({
        schema,
        db,
        dialect: "invalid-dialect" as "sqlite",
        tableMap: { todos: "todos" },
      });
    }).toThrow("Invalid config: must provide dialect or custom commands");
  });
});
