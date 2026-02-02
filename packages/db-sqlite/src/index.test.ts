import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHlcState, makeUpsert, tickHlc, type Change, defineSchema, s } from '@rippledb/core';
import { createSyncMaterializer, createSyncSqlExecutor } from '@rippledb/materialize-db';
import type { InferSchema } from '@rippledb/core';
import { createDrizzleSyncMaterializer } from '@rippledb/materialize-drizzle';
import type { MaterializerState } from '@rippledb/materialize-core';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { getTableConfig, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { SqliteDb, type SqliteDatabase } from './index';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

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

const todosTable = sqliteTable('todos', {
  id: text('id').primaryKey(),
  title: text('title'),
  done: integer('done'),
});

const tagsTable = sqliteTable('ripple_tags', {
  entity: text('entity').notNull(),
  id: text('id').notNull(),
  data: text('data').notNull(),
  tags: text('tags').notNull(),
  deleted: integer('deleted').notNull().default(0),
  deleted_tag: text('deleted_tag'),
});

describe('SqliteDb', () => {
  let db: SqliteDb<TestSchema, typeof schema>;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `test-sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new SqliteDb({
      filename: dbPath,
      schema,
    });
  });

  afterEach(() => {
    db.close();
    // Clean up temp file
    try {
      unlinkSync(dbPath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it('appends changes and pulls them back', async () => {
    const hlc = tickHlc(createHlcState('node-1'), 100);
    const change = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { id: 'todo-1', title: 'Buy milk', done: false },
      hlc,
    });

    const appendResult = await db.append({
      stream: 'test',
      changes: [change],
    });

    expect(appendResult.accepted).toBe(1);

    const pullResult = await db.pull({
      stream: 'test',
      cursor: null,
      limit: 10,
    });

    expect(pullResult.changes).toHaveLength(1);
    expect(pullResult.changes[0].entity).toBe('todos');
    expect(pullResult.changes[0].entityId).toBe('todo-1');
    expect(pullResult.nextCursor).toBeTruthy();
  });

  it('handles idempotency keys', async () => {
    const hlc = tickHlc(createHlcState('node-1'), 100);
    const change = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { id: 'todo-1', title: 'Buy milk', done: false },
      hlc,
    });

    const firstAppend = await db.append({
      stream: 'test',
      idempotencyKey: 'key-1',
      changes: [change],
    });

    expect(firstAppend.accepted).toBe(1);

    // Same idempotency key should be rejected
    const secondAppend = await db.append({
      stream: 'test',
      idempotencyKey: 'key-1',
      changes: [change],
    });

    expect(secondAppend.accepted).toBe(0);
  });

  it('materializes changes when materializer is configured', async () => {
    // Create entity table and tags table first
    db.close();
    const setupDb = new SqliteDb<TestSchema, typeof schema>({ filename: dbPath, schema });
    setupDb['db'].exec(`
      CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER);
    `);
    setupDb.close();

    const dbWithMaterializer = new SqliteDb<TestSchema, typeof schema>({
      filename: dbPath,
      schema,
      materializer: ({ db, schema }) => {
        return createSyncMaterializer({
          schema,
          db,
          dialect: 'sqlite',
          tableMap: { todos: 'todos' },
          fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
        });
      },
    });

    const hlc = tickHlc(createHlcState('node-1'), 100);
    const change = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { id: 'todo-1', title: 'Buy milk', done: false },
      hlc,
    });

    await dbWithMaterializer.append({
      stream: 'test',
      changes: [change],
    });

    // Verify materialization: check that the todo was saved to the todos table
    const verifyDb = new SqliteDb<TestSchema, typeof schema>({ filename: dbPath, schema });
    const todos = verifyDb['db']
      .prepare('SELECT id, title, done FROM todos WHERE id = ?')
      .all('todo-1') as Array<{ id: string; title: string; done: number }>;
    verifyDb.close();

    expect(todos).toHaveLength(1);
    expect(todos[0].id).toBe('todo-1');
    expect(todos[0].title).toBe('Buy milk');
    expect(todos[0].done).toBe(0); // SQLite stores booleans as integers

    dbWithMaterializer.close();
  });

  it('handles cursor pagination', async () => {
    const changes = Array.from({ length: 5 }, (_, i) => {
      const hlc = tickHlc(createHlcState('node-1'), 100 + i);
      return makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todos',
        entityId: `todo-${i}`,
        patch: { id: `todo-${i}`, title: `Todo ${i}`, done: false },
        hlc,
      });
    });

    await db.append({
      stream: 'test',
      changes,
    });

    // Pull first 2
    const firstPull = await db.pull({
      stream: 'test',
      cursor: null,
      limit: 2,
    });

    expect(firstPull.changes).toHaveLength(2);
    expect(firstPull.nextCursor).toBeTruthy();

    // Pull next 2 using cursor
    const secondPull = await db.pull({
      stream: 'test',
      cursor: firstPull.nextCursor,
      limit: 2,
    });

    expect(secondPull.changes).toHaveLength(2);
    expect(secondPull.nextCursor).toBeTruthy();

    // Pull remaining
    const thirdPull = await db.pull({
      stream: 'test',
      cursor: secondPull.nextCursor,
      limit: 2,
    });

    expect(thirdPull.changes).toHaveLength(1);
  });

  it('rolls back all writes when materialization fails (atomicity)', async () => {
    // Create entity table with CHECK constraint
    db.close();
    const tempDb = new SqliteDb<TestSchema, typeof schema>({
      filename: dbPath,
      schema,
      materializer: ({ db, schema }) => {
        return createSyncMaterializer({
          schema,
          db,
          dialect: 'sqlite',
          tableMap: { todos: 'todos' },
          fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
        });
      },
    });

    // Create table with CHECK constraint
    tempDb.close();
    const setupDb = new SqliteDb<TestSchema, typeof schema>({ filename: dbPath, schema });
    setupDb['db'].exec(`
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT,
        done INTEGER CHECK (done IN (0, 1))
      );
    `);
    setupDb.close();

    const dbWithMaterializer = new SqliteDb<TestSchema, typeof schema>({
      filename: dbPath,
      schema,
      materializer: ({ db, schema }) => {
        return createSyncMaterializer({
          schema,
          db,
          dialect: 'sqlite',
          tableMap: { todos: 'todos' },
          fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
        });
      },
    });

    // First, insert a valid change
    const firstChange = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { id: 'todo-1', title: 'First todo', done: false },
      hlc: tickHlc(createHlcState('node-1'), 100),
    });

    await dbWithMaterializer.append({
      stream: 'test',
      changes: [firstChange],
    });

    // Verify it was written
    const verifyDb1 = new SqliteDb<TestSchema, typeof schema>({ filename: dbPath, schema });
    const count1 = verifyDb1['db']
      .prepare('SELECT COUNT(*) as count FROM ripple_changes WHERE stream = ?')
      .get('test') as { count: number };
    verifyDb1.close();
    expect(count1.count).toBe(1);

    // Now try to append two changes: one valid, one that will violate CHECK constraint
    const validChange = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-2',
      patch: { id: 'todo-2', title: 'Second todo', done: false },
      hlc: tickHlc(createHlcState('node-1'), 101),
    });

    // This will violate the CHECK constraint (done = 2 is not allowed)
    const invalidChange = {
      ...makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todos',
        entityId: 'todo-invalid',
        patch: { id: 'todo-invalid', title: 'Invalid', done: false },
        hlc: tickHlc(createHlcState('node-1'), 102),
      }),
      patch: { id: 'todo-invalid', title: 'Invalid', done: 2 }, // Violates CHECK constraint
    } as unknown as Change<TestSchema>;

    // Try to append both - the invalid one should cause the whole transaction to fail
    await expect(
      dbWithMaterializer.append({
        stream: 'test',
        changes: [validChange, invalidChange],
      }),
    ).rejects.toThrow();

    // Verify that NEITHER change was written to the change log (atomic rollback)
    const verifyDb2 = new SqliteDb<TestSchema, typeof schema>({ filename: dbPath, schema });
    const count2 = verifyDb2['db']
      .prepare('SELECT COUNT(*) as count FROM ripple_changes WHERE stream = ?')
      .get('test') as { count: number };
    verifyDb2.close();

    // Should still be 1 (only the first change from before)
    expect(count2.count).toBe(1);

    // Verify that the new todos were NOT materialized
    const verifyDb3 = new SqliteDb<TestSchema, typeof schema>({ filename: dbPath, schema });
    const todos = verifyDb3['db']
      .prepare('SELECT id FROM todos WHERE id IN (?, ?)')
      .all('todo-2', 'todo-invalid') as Array<{ id: string }>;
    verifyDb3.close();

    expect(todos).toHaveLength(0); // Neither should be materialized

    dbWithMaterializer.close();
  });

  it('rolls back all writes when drizzle materializer fails (atomicity)', async () => {
    db.close();
    const setupDb = new SqliteDb<TestSchema, typeof schema>({ filename: dbPath, schema });
    setupDb['db'].exec(`
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
    setupDb.close();

    const dbWithDrizzleMaterializer = new SqliteDb<TestSchema, typeof schema>({
      filename: dbPath,
      schema,
      materializer: ({ db, schema }) => {
        const drizzleDb = drizzle(db);
        const adapter = createDrizzleSyncMaterializer({
          schema,
          tableMap: { todos: todosTable },
          tagsTableDef: tagsTable,
          getTableConfig,
          fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
          normalizeValue: (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value),
        });
        type SchemaType = InferSchema<typeof schema>;
        return {
          load: <E extends keyof TestSchema & string>(dbInstance: SqliteDatabase, entity: E, id: string) => {
            void dbInstance;
            return adapter.load(drizzleDb, entity, id) as unknown as MaterializerState<TestSchema, E> | null;
          },
          save: <E extends keyof TestSchema & string>(
            dbInstance: SqliteDatabase,
            entity: E,
            id: string,
            state: MaterializerState<TestSchema, E>,
          ) => {
            void dbInstance;
            return adapter.save(
              drizzleDb,
              entity,
              id,
              state as unknown as MaterializerState<SchemaType, E>,
            );
          },
          remove: <E extends keyof TestSchema & string>(
            dbInstance: SqliteDatabase,
            entity: E,
            id: string,
            state: MaterializerState<TestSchema, E>,
          ) => {
            void dbInstance;
            return adapter.remove(
              drizzleDb,
              entity,
              id,
              state as unknown as MaterializerState<SchemaType, E>,
            );
          },
        };
      },
    });

    // Create a change with done: 2 which violates CHECK (done IN (0, 1)) constraint
    const invalidChange = {
      ...makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todos',
        entityId: 'todo-1',
        patch: { id: 'todo-1', title: 'Buy milk', done: false },
        hlc: tickHlc(createHlcState('node-1'), 100),
      }),
      patch: { id: 'todo-1', title: 'Buy milk', done: 2 }, // Violates CHECK constraint
    } as unknown as Change<TestSchema>;

    await expect(
      dbWithDrizzleMaterializer.append({
        stream: 'test',
        changes: [invalidChange],
      }),
    ).rejects.toThrow();

    const verifyDb = new SqliteDb<TestSchema, typeof schema>({ filename: dbPath, schema });
    const count = verifyDb['db']
      .prepare('SELECT COUNT(*) as count FROM ripple_changes WHERE stream = ?')
      .get('test') as { count: number };
    const todos = verifyDb['db']
      .prepare('SELECT id FROM todos WHERE id = ?')
      .all('todo-1') as Array<{ id: string }>;
    verifyDb.close();

    expect(count.count).toBe(0);
    expect(todos).toHaveLength(0);

    dbWithDrizzleMaterializer.close();
  });

  it('rolls back all writes when materializer generates invalid SQL (adapter-level test)', async () => {
    // Create entity table
    db.close();
    const setupDb = new SqliteDb<TestSchema, typeof schema>({ filename: dbPath, schema });
    setupDb['db'].exec(`
      CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER);
    `);
    setupDb.close();

    // Create a materializer with a custom executor that generates invalid SQL
    // This will cause the transaction to fail, testing atomicity through the adapter
    const dbWithInvalidMaterializer = new SqliteDb<TestSchema, typeof schema>({
      filename: dbPath,
      schema,
      materializer: ({ db, schema }) => {
        // For this test, we need a custom executor that generates invalid SQL
        // We'll use createSyncMaterializer with a custom executor
        const executor = createSyncSqlExecutor({
          tableMap: { todos: 'todos' },
          fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
          // Custom commands that will generate invalid SQL
          loadCommand: (tagsTable: string) =>
            `SELECT data, tags, deleted, deleted_tag FROM ${tagsTable} WHERE entity = ? AND id = ?`,
          saveCommand: (tagsTable: string) =>
            `INSERT OR REPLACE INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag) VALUES (?, ?, ?, ?, 0, NULL)`,
          removeCommand: (tagsTable: string) =>
            `INSERT OR REPLACE INTO ${tagsTable} (entity, id, data, tags, deleted, deleted_tag) VALUES (?, ?, ?, ?, 1, ?)`,
          // This will generate invalid SQL - trying to insert into a non-existent column
          saveEntityCommand: (tableName: string, id: string, columns: string[], values: unknown[]) => ({
            sql: `INSERT INTO ${tableName} (id, ${columns.join(', ')}, invalid_column) VALUES (?, ${values.map(() => '?').join(', ')}, ?)`,
            params: [id, ...values, 'invalid'],
          }),
        });
        return createSyncMaterializer({
          schema,
          db,
          executor,
          tableMap: { todos: 'todos' },
        });
      },
    });

    // Create two valid changes
    const change1 = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { id: 'todo-1', title: 'First todo', done: false },
      hlc: tickHlc(createHlcState('node-1'), 100),
    });

    const change2 = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-2',
      patch: { id: 'todo-2', title: 'Second todo', done: false },
      hlc: tickHlc(createHlcState('node-1'), 101),
    });

    // Try to append both - the invalid SQL should cause the whole transaction to fail
    await expect(
      dbWithInvalidMaterializer.append({
        stream: 'test',
        changes: [change1, change2],
      }),
    ).rejects.toThrow();

    // Verify that NEITHER change was written to the change log (atomic rollback)
    const verifyDb = new SqliteDb<TestSchema, typeof schema>({ filename: dbPath, schema });
    const count = verifyDb['db']
      .prepare('SELECT COUNT(*) as count FROM ripple_changes WHERE stream = ?')
      .get('test') as { count: number };
    verifyDb.close();

    expect(count.count).toBe(0); // No changes should be persisted

    // Verify that NEITHER todo was materialized
    const verifyDb2 = new SqliteDb<TestSchema, typeof schema>({ filename: dbPath, schema });
    const todos = verifyDb2['db']
      .prepare('SELECT id FROM todos WHERE id IN (?, ?)')
      .all('todo-1', 'todo-2') as Array<{ id: string }>;
    verifyDb2.close();

    expect(todos).toHaveLength(0); // Neither should be materialized

    dbWithInvalidMaterializer.close();
  });

  it('accepts external db instance and allows custom Drizzle queries', async () => {
    // Create external database instance
    const sqlite = new Database(dbPath);
    sqlite.exec(`
      CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER);
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

    // Create Drizzle instance sharing the same connection
    const drizzleDb = drizzle(sqlite);

    // Create SqliteDb with external db
    const rippleDb = new SqliteDb<TestSchema, typeof schema>({
      db: sqlite,
      schema,
      materializer: ({ schema }) => {
        const adapter = createDrizzleSyncMaterializer({
          schema,
          tableMap: { todos: todosTable },
          tagsTableDef: tagsTable,
          getTableConfig,
          fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
          normalizeValue: (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value),
        });
        type SchemaType = InferSchema<typeof schema>;
        return {
          load: <E extends keyof TestSchema & string>(dbInstance: SqliteDatabase, entity: E, id: string) => {
            void dbInstance;
            return adapter.load(drizzleDb, entity, id) as unknown as MaterializerState<TestSchema, E> | null;
          },
          save: <E extends keyof TestSchema & string>(
            dbInstance: SqliteDatabase,
            entity: E,
            id: string,
            state: MaterializerState<TestSchema, E>,
          ) => {
            void dbInstance;
            return adapter.save(
              drizzleDb,
              entity,
              id,
              state as unknown as MaterializerState<SchemaType, E>,
            );
          },
          remove: <E extends keyof TestSchema & string>(
            dbInstance: SqliteDatabase,
            entity: E,
            id: string,
            state: MaterializerState<TestSchema, E>,
          ) => {
            void dbInstance;
            return adapter.remove(
              drizzleDb,
              entity,
              id,
              state as unknown as MaterializerState<SchemaType, E>,
            );
          },
        };
      },
    });

    // Append via rippledb
    const hlc = tickHlc(createHlcState('node-1'), 100);
    await rippleDb.append({
      stream: 'test',
      changes: [
        makeUpsert<TestSchema>({
          stream: 'test',
          entity: 'todos',
          entityId: 'todo-1',
          patch: { id: 'todo-1', title: 'Buy milk', done: false },
          hlc,
        }),
      ],
    });

    // Query via Drizzle on the same connection
    const todos = drizzleDb.select().from(todosTable).all();
    expect(todos).toHaveLength(1);
    expect(todos[0]).toEqual({ id: 'todo-1', title: 'Buy milk', done: 0 });

    // close() should be a no-op since we provided external db
    rippleDb.close();

    // Database should still be open and usable
    const todosAfterClose = drizzleDb.select().from(todosTable).all();
    expect(todosAfterClose).toHaveLength(1);

    // Clean up - we own the db, so we close it
    sqlite.close();
  });

  // Note: "both db and filename" and "neither db nor filename" cases
  // are now enforced at compile-time by the discriminated union type
});
