import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHlcState, makeDelete, makeUpsert, tickHlc } from '@rippledb/core';
import { materializeChange, type MaterializerAdapter } from '@rippledb/materialize-core';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { createCustomMaterializer, createSqlExecutor } from './adapter';
import type { Db } from './types';
import { createPostgresDb, type TestSchema } from './test-helpers';

// Each test suite gets its own database for complete isolation
const TEST_DB_NAME = 'test_materialize_db';

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

      // Create isolated database for this test suite
      const adminClient = new pg.Client({ connectionString: container.getConnectionUri() });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
      await adminClient.query(`CREATE DATABASE ${TEST_DB_NAME}`);
      await adminClient.end();
    } catch {
      throw new Error('PostgreSQL testcontainer failed to start');
    }
  }, 30000);

  afterAll(async () => {
    if (dbClose) {
      await dbClose();
      dbClose = null;
    }
    // Drop the test database
    if (container) {
      const adminClient = new pg.Client({ connectionString: container.getConnectionUri() });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
      await adminClient.end();
    }
    // Don't call container.stop() - with .withReuse(), the container stays
    // running for fast reuse across test runs. Ryuk will clean up after idle timeout.
  });

  beforeEach(async () => {
    if (!container) {
      throw new Error('Container not started');
    }
    // Close previous connection if it exists
    if (dbClose) {
      await dbClose();
    }
    // Connect to our isolated database
    const baseUri = container.getConnectionUri();
    const dbUri = baseUri.replace(/\/[^/]+$/, `/${TEST_DB_NAME}`);
    const dbWrapper = createPostgresDb(dbUri);
    db = dbWrapper.db;
    dbClose = dbWrapper.close;
    // Create fresh tables
    await db.run('DROP TABLE IF EXISTS todos', []);
    await db.run('DROP TABLE IF EXISTS ripple_tags', []);
    await db.run('CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER)', []);
    const sqlConfig = {
      dialect: 'postgresql',
      tableMap: { todos: 'todos' },
    } as const;
    adapter = createCustomMaterializer<TestSchema>({
      tableMap: sqlConfig.tableMap,
      executor: createSqlExecutor(sqlConfig, db),
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
    const sqlConfig = {
      dialect: 'postgresql',
      tableMap: { todos: 'todos' },
      fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
    } as const;
    const adapterWithFieldMap = createCustomMaterializer<TestSchema>({
      tableMap: sqlConfig.tableMap,
      fieldMap: sqlConfig.fieldMap,
      executor: createSqlExecutor(sqlConfig, db),
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
      'SELECT data, tags, deleted FROM ripple_tags WHERE entity = $1 AND id = $2',
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
