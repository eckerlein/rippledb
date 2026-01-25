import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHlcState, makeUpsert, tickHlc } from '@converge/core';
import { SqliteDb } from './index';
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

describe('SqliteDb', () => {
  let db: SqliteDb<TestSchema>;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `test-sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new SqliteDb({
      filename: dbPath,
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

  it('rolls back all writes when materialization fails (atomicity)', async () => {
    // Create entity table with CHECK constraint
    db.close();
    const tempDb = new SqliteDb<TestSchema>({
      filename: dbPath,
      materializer: {
        dialect: 'sqlite',
        tableMap: { todos: 'todos' },
        fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
      },
    });

    // Create table with CHECK constraint
    tempDb.close();
    const setupDb = new SqliteDb<TestSchema>({ filename: dbPath });
    setupDb['db'].exec(`
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT,
        done INTEGER CHECK (done IN (0, 1))
      );
    `);
    setupDb.close();

    const dbWithMaterializer = new SqliteDb<TestSchema>({
      filename: dbPath,
      materializer: {
        dialect: 'sqlite',
        tableMap: { todos: 'todos' },
        fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
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
    const verifyDb1 = new SqliteDb<TestSchema>({ filename: dbPath });
    const count1 = verifyDb1['db']
      .prepare('SELECT COUNT(*) as count FROM converge_changes WHERE stream = ?')
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
    const invalidChange = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-invalid',
      patch: { id: 'todo-invalid', title: 'Invalid', done: 2 as any },
      hlc: tickHlc(createHlcState('node-1'), 102),
    });

    // Try to append both - the invalid one should cause the whole transaction to fail
    await expect(
      dbWithMaterializer.append({
        stream: 'test',
        changes: [validChange, invalidChange],
      }),
    ).rejects.toThrow();

    // Verify that NEITHER change was written to the change log (atomic rollback)
    const verifyDb2 = new SqliteDb<TestSchema>({ filename: dbPath });
    const count2 = verifyDb2['db']
      .prepare('SELECT COUNT(*) as count FROM converge_changes WHERE stream = ?')
      .get('test') as { count: number };
    verifyDb2.close();

    // Should still be 1 (only the first change from before)
    expect(count2.count).toBe(1);

    // Verify that the new todos were NOT materialized
    const verifyDb3 = new SqliteDb<TestSchema>({ filename: dbPath });
    const todos = verifyDb3['db']
      .prepare('SELECT id FROM todos WHERE id IN (?, ?)')
      .all('todo-2', 'todo-invalid') as Array<{ id: string }>;
    verifyDb3.close();

    expect(todos).toHaveLength(0); // Neither should be materialized

    dbWithMaterializer.close();
  });
});
