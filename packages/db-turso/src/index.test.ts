import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHlcState, makeUpsert, tickHlc, type Change } from '@converge/core';
import { TursoDb } from './index';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { createSqlExecutor } from '@converge/materialize-db';

type TestSchema = {
  todos: {
    id: string;
    title: string;
    done: boolean;
  };
};

describe('TursoDb', () => {
  let db: TursoDb<TestSchema>;
  let dbPath: string;

  beforeEach(() => {
    // Use a temporary file for testing (libSQL can use file: protocol)
    dbPath = join(tmpdir(), `test-turso-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new TursoDb({
      url: `file:${dbPath}`,
      authToken: '', // Not needed for local file mode
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
    // Create entity table and tags table first using a separate client
    // The materializer will create tags table on first use, but we need it for the load() call
    const setupClient = createClient({
      url: `file:${dbPath}`,
      authToken: '',
    });
    await setupClient.batch([
      {
        sql: 'CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER)',
        args: [],
      },
      {
        sql: `CREATE TABLE IF NOT EXISTS converge_tags (
          entity TEXT NOT NULL,
          id TEXT NOT NULL,
          data TEXT NOT NULL,
          tags TEXT NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0,
          deleted_tag TEXT,
          PRIMARY KEY (entity, id)
        )`,
        args: [],
      },
    ]);
    setupClient.close();

    const dbWithMaterializer = new TursoDb<TestSchema>({
      url: `file:${dbPath}`,
      authToken: '',
      materializer: ({ db }) => {
        const sqlConfig = {
          dialect: 'sqlite',
          tableMap: { todos: 'todos' },
          fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
        } as const;
        return {
          tableMap: sqlConfig.tableMap,
          fieldMap: sqlConfig.fieldMap,
          executor: createSqlExecutor(sqlConfig, db),
        };
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

    // Small delay to ensure batch execution completes
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify materialization: check that the todo was saved to the todos table
    const verifyClient = createClient({
      url: `file:${dbPath}`,
      authToken: '',
    });
    const result = await verifyClient.execute({
      sql: 'SELECT id, title, done FROM todos WHERE id = ?',
      args: ['todo-1'],
    });
    verifyClient.close();

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.id).toBe('todo-1');
    expect(row.title).toBe('Buy milk');
    expect(row.done).toBe(0); // SQLite stores booleans as integers

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
    // Create entity table
    const setupClient = createClient({
      url: `file:${dbPath}`,
      authToken: '',
    });
    await setupClient.batch([
      {
        sql: 'CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER)',
        args: [],
      },
      {
        sql: `CREATE TABLE IF NOT EXISTS converge_tags (
          entity TEXT NOT NULL,
          id TEXT NOT NULL,
          data TEXT NOT NULL,
          tags TEXT NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0,
          deleted_tag TEXT,
          PRIMARY KEY (entity, id)
        )`,
        args: [],
      },
    ]);
    setupClient.close();

    const dbWithMaterializer = new TursoDb<TestSchema>({
      url: `file:${dbPath}`,
      authToken: '',
      materializer: ({ db }) => {
        const sqlConfig = {
          dialect: 'sqlite',
          tableMap: { todos: 'todos' },
          fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
        } as const;
        return {
          tableMap: sqlConfig.tableMap,
          fieldMap: sqlConfig.fieldMap,
          executor: createSqlExecutor(sqlConfig, db),
        };
      },
    });

    // First, insert a valid change to create todo-1
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
    const verifyClient1 = createClient({
      url: `file:${dbPath}`,
      authToken: '',
    });
    const count1 = await verifyClient1.execute({
      sql: 'SELECT COUNT(*) as count FROM converge_changes WHERE stream = ?',
      args: ['test'],
    });
    verifyClient1.close();
    expect(count1.rows[0]?.count).toBe(1);

    // Now try to append two changes: one valid, one that will violate CHECK constraint
    const setupClient2 = createClient({
      url: `file:${dbPath}`,
      authToken: '',
    });
    await setupClient2.execute({
      sql: 'DROP TABLE IF EXISTS todos',
      args: [],
    });
    await setupClient2.execute({
      sql: 'CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER CHECK (done IN (0, 1)))',
      args: [],
    });
    setupClient2.close();

    // Create a valid change
    const validChange = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-2',
      patch: { id: 'todo-2', title: 'Second todo', done: false },
      hlc: tickHlc(createHlcState('node-1'), 101),
    });

    // Create a change that violates the CHECK constraint (done = 2)
    const invalidChange = {
      ...makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todos',
        entityId: 'todo-invalid',
        patch: { id: 'todo-invalid', title: 'Invalid', done: false },
        hlc: tickHlc(createHlcState('node-1'), 103),
      }),
      patch: { id: 'todo-invalid', title: 'Invalid', done: 2 }, // Violates CHECK constraint
    } as unknown as Change<TestSchema>;

    // Try to append both - the invalid one should cause the whole batch to fail
    await expect(
      dbWithMaterializer.append({
        stream: 'test',
        changes: [validChange, invalidChange],
      }),
    ).rejects.toThrow();

    // Verify that NEITHER change was written to the change log (atomic rollback)
    const verifyClient2 = createClient({
      url: `file:${dbPath}`,
      authToken: '',
    });
    const changeLogResult = await verifyClient2.execute({
      sql: 'SELECT COUNT(*) as count FROM converge_changes WHERE stream = ?',
      args: ['test'],
    });
    verifyClient2.close();

    // Should still be 1 (only the first change from before)
    const changeCount = changeLogResult.rows[0]?.count;
    expect(changeCount).toBe(1); // Only the first change should exist

    // Verify that the new todos were NOT materialized
    const verifyClient3 = createClient({
      url: `file:${dbPath}`,
      authToken: '',
    });
    const todosResult = await verifyClient3.execute({
      sql: 'SELECT id FROM todos WHERE id IN (?, ?)',
      args: ['todo-2', 'todo-invalid'],
    });
    verifyClient3.close();

    expect(todosResult.rows).toHaveLength(0); // Neither should be materialized

    dbWithMaterializer.close();
  });

  it('rolls back all writes when materializer generates invalid SQL (adapter-level test)', async () => {
    // Create entity table
    const setupClient = createClient({
      url: `file:${dbPath}`,
      authToken: '',
    });
    await setupClient.batch([
      {
        sql: 'CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER)',
        args: [],
      },
      {
        sql: `CREATE TABLE IF NOT EXISTS converge_tags (
          entity TEXT NOT NULL,
          id TEXT NOT NULL,
          data TEXT NOT NULL,
          tags TEXT NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0,
          deleted_tag TEXT,
          PRIMARY KEY (entity, id)
        )`,
        args: [],
      },
    ]);
    setupClient.close();

    // Create a materializer with a custom saveEntityCommand that generates invalid SQL
    // This will cause the batch to fail, testing atomicity through the adapter
    const dbWithInvalidMaterializer = new TursoDb<TestSchema>({
      url: `file:${dbPath}`,
      authToken: '',
      materializer: ({ db }) => {
        const sqlConfig = {
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
        };
        return {
          tableMap: sqlConfig.tableMap,
          fieldMap: sqlConfig.fieldMap,
          executor: createSqlExecutor(sqlConfig, db),
        };
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

    // Try to append both - the invalid SQL should cause the whole batch to fail
    await expect(
      dbWithInvalidMaterializer.append({
        stream: 'test',
        changes: [change1, change2],
      }),
    ).rejects.toThrow();

    // Verify that NEITHER change was written to the change log (atomic rollback)
    const verifyClient = createClient({
      url: `file:${dbPath}`,
      authToken: '',
    });
    const changeLogResult = await verifyClient.execute({
      sql: 'SELECT COUNT(*) as count FROM converge_changes WHERE stream = ?',
      args: ['test'],
    });
    verifyClient.close();

    const changeCount = changeLogResult.rows[0]?.count;
    expect(changeCount).toBe(0); // No changes should be persisted

    // Verify that NEITHER todo was materialized
    const verifyClient2 = createClient({
      url: `file:${dbPath}`,
      authToken: '',
    });
    const todosResult = await verifyClient2.execute({
      sql: 'SELECT id FROM todos WHERE id IN (?, ?)',
      args: ['todo-1', 'todo-2'],
    });
    verifyClient2.close();

    expect(todosResult.rows).toHaveLength(0); // Neither should be materialized

    dbWithInvalidMaterializer.close();
  });
});
