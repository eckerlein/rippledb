import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHlcState, makeUpsert, tickHlc } from '@converge/core';
import { TursoDb } from './index';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { createClient } from '@libsql/client';

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
      materializer: {
        dialect: 'sqlite',
        tableMap: { todos: 'todos' },
        fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
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

    const rows = result.rows as unknown as Array<{ id: string; title: string; done: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('todo-1');
    expect(rows[0].title).toBe('Buy milk');
    expect(rows[0].done).toBe(0); // SQLite stores booleans as integers

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
});
