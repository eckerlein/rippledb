import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHlcState, makeDelete, makeUpsert, tickHlc } from '@converge/core';
import { materializeChange, type MaterializerAdapter } from '@converge/materialize-core';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createCustomMaterializer } from './adapter';
import type { Db } from './types';
import { createPostgresDb, type TestSchema } from './test-helpers';

describe('createCustomMaterializer - PostgreSQL dialect', () => {
  let container: StartedPostgreSqlContainer | null = null;
  let db: Db;
  let dbClose: (() => Promise<void>) | null = null;
  let adapter: MaterializerAdapter<TestSchema>;

  beforeAll(async () => {
    try {
      container = await new PostgreSqlContainer('postgres:16-alpine')
        .withReuse()
        .start();
    } catch {
      throw new Error('PostgreSQL testcontainer failed to start');
    }
  }, 30000);

  afterAll(async () => {
    if (dbClose) {
      await dbClose();
    }
    if (container) {
      await container.stop();
    }
  });

  beforeEach(async () => {
    if (!container) {
      throw new Error('Container not started');
    }
    // Close previous connection if it exists
    if (dbClose) {
      await dbClose();
    }
    const dbWrapper = createPostgresDb(container.getConnectionUri());
    db = dbWrapper.db;
    dbClose = dbWrapper.close;
    // Create entity table
    await db.run(
      'CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER)',
      [],
    );
    adapter = createCustomMaterializer<TestSchema>({
      db,
      dialect: 'postgresql',
      tableMap: { todos: 'todos' },
    });
  });

  afterEach(async () => {
    // Ensure connection is closed after each test
    if (dbClose) {
      await dbClose();
      dbClose = null;
    }
  });

  it('creates tags table and saves entity', async () => {
    const adapterWithFieldMap = createCustomMaterializer<TestSchema>({
      db,
      dialect: 'postgresql',
      tableMap: { todos: 'todos' },
      fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
    });

    const hlc = tickHlc(createHlcState('node-1'), 100);
    const change = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { id: 'todo-1', title: 'Buy milk', done: false },
      hlc,
    });

    await materializeChange(adapterWithFieldMap, change);

    // Verify tags table exists and has data
    const row = await db.get<{ data: string; tags: string; deleted: number }>(
      'SELECT data, tags, deleted FROM converge_tags WHERE entity = $1 AND id = $2',
      ['todos', 'todo-1'],
    );
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.data)).toEqual({ id: 'todo-1', title: 'Buy milk', done: false });
    expect(row!.deleted).toBe(0);

    // Check entity table
    const entityRow = await db.get<{ id: string; title: string; done: number }>(
      'SELECT id, title, done FROM todos WHERE id = $1',
      ['todo-1'],
    );
    expect(entityRow).toEqual({ id: 'todo-1', title: 'Buy milk', done: 0 });
  });

  it('handles updates and deletes', async () => {
    const hlc1 = tickHlc(createHlcState('node-1'), 100);
    const change1 = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { id: 'todo-1', title: 'Buy milk', done: false },
      hlc: hlc1,
    });
    await materializeChange(adapter, change1);

    const hlc2 = tickHlc(createHlcState('node-1'), 101);
    const change2 = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { done: true },
      hlc: hlc2,
    });
    await materializeChange(adapter, change2);

    const state1 = await adapter.load('todos', 'todo-1');
    expect(state1!.values.done).toBe(true);

    const hlc3 = tickHlc(createHlcState('node-1'), 102);
    const change3 = makeDelete<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      hlc: hlc3,
    });
    await materializeChange(adapter, change3);

    const state2 = await adapter.load('todos', 'todo-1');
    expect(state2!.deleted).toBe(true);
  });
});
