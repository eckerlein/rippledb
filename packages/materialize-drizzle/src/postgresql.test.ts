import {
  createHlcState,
  defineSchema,
  makeDelete,
  makeUpsert,
  s,
  tickHlc,
} from "@rippledb/core";
import { materializeChange } from "@rippledb/materialize-core";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, integer, pgTable, text } from "drizzle-orm/pg-core";
import { Client } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createDrizzleMaterializer } from "./index";

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

const todosTable = pgTable("todos", {
  id: text("id").primaryKey(),
  title: text("title"),
  done: integer("done"),
});

const tagsTable = pgTable("ripple_tags", {
  entity: text("entity").notNull(),
  id: text("id").notNull(),
  data: text("data").notNull(),
  tags: text("tags").notNull(),
  deleted: integer("deleted").notNull().default(0),
  deleted_tag: text("deleted_tag"),
});

// Each test suite gets its own database for complete isolation
const TEST_DB_NAME = "test_drizzle";

describe("materialize-drizzle (postgresql)", () => {
  let container: StartedPostgreSqlContainer | null = null;
  let client: Client | null = null;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withReuse()
      .start();

    // Create isolated database for this test suite
    const adminClient = new Client({
      connectionString: container.getConnectionUri(),
    });
    await adminClient.connect();
    await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    await adminClient.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    await adminClient.end();
  }, 30000);

  afterAll(async () => {
    if (client) {
      await client.end();
      client = null;
    }
    // Drop the test database
    if (container) {
      const adminClient = new Client({
        connectionString: container.getConnectionUri(),
      });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
      await adminClient.end();
    }
    // Don't call container.stop() - with .withReuse(), the container stays
    // running for fast reuse across test runs. Ryuk will clean up after idle timeout.
  });

  beforeEach(async () => {
    if (!container) {
      throw new Error("Container not started");
    }
    if (client) {
      await client.end();
    }
    // Connect to our isolated database
    const baseUri = container.getConnectionUri();
    const dbUri = baseUri.replace(/\/[^/]+$/, `/${TEST_DB_NAME}`);
    client = new Client({ connectionString: dbUri });
    await client.connect();
    // Create fresh tables
    await client.query("DROP TABLE IF EXISTS todos");
    await client.query("DROP TABLE IF EXISTS ripple_tags");
    await client.query(
      "CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER)",
    );
    await client.query(`CREATE TABLE ripple_tags (
      entity TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      tags TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_tag TEXT,
      PRIMARY KEY (entity, id)
    )`);
  });

  afterEach(async () => {
    if (client) {
      await client.end();
      client = null;
    }
  });

  it("materializes upserts into tags and entity tables", async () => {
    if (!client) throw new Error("Client not connected");
    const db = drizzle(client);
    const adapter = createDrizzleMaterializer({
      schema,
      tableMap: { todos: todosTable },
      tagsTableDef: tagsTable,
      getTableConfig,
      fieldMap: { todos: { id: "id", title: "title", done: "done" } },
      normalizeValue: value =>
        typeof value === "boolean" ? (value ? 1 : 0) : value,
    });

    const hlc = tickHlc(createHlcState("node-1"), 100);
    const change = makeUpsert<TestSchema>({
      stream: "test",
      entity: "todos",
      entityId: "todo-1",
      patch: { id: "todo-1", title: "Buy milk", done: false },
      hlc,
    });

    await materializeChange(adapter, db, change);

    const tagsRow = await client.query(
      "SELECT data, tags, deleted FROM ripple_tags WHERE entity = $1 AND id = $2",
      ["todos", "todo-1"],
    );
    expect(tagsRow.rows.length).toBe(1);
    expect(JSON.parse(tagsRow.rows[0].data)).toEqual({
      id: "todo-1",
      title: "Buy milk",
      done: false,
    });
    expect(tagsRow.rows[0].deleted).toBe(0);

    const todoRow = await client.query(
      "SELECT id, title, done FROM todos WHERE id = $1",
      ["todo-1"],
    );
    expect(todoRow.rows[0]).toEqual({
      id: "todo-1",
      title: "Buy milk",
      done: 0,
    });
  });

  it("handles deletes by marking tags", async () => {
    if (!client) throw new Error("Client not connected");
    const db = drizzle(client);
    const adapter = createDrizzleMaterializer({
      schema,
      tableMap: { todos: todosTable },
      tagsTableDef: tagsTable,
      getTableConfig,
      fieldMap: { todos: { id: "id", title: "title", done: "done" } },
      normalizeValue: value =>
        typeof value === "boolean" ? (value ? 1 : 0) : value,
    });

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
    await materializeChange(adapter, db, change2);

    const tagsRow = await client.query(
      "SELECT deleted, deleted_tag FROM ripple_tags WHERE entity = $1 AND id = $2",
      ["todos", "todo-1"],
    );
    expect(tagsRow.rows.length).toBe(1);
    expect(tagsRow.rows[0].deleted).toBe(1);
    expect(tagsRow.rows[0].deleted_tag).toBeTruthy();
  });
});
