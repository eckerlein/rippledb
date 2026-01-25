import { beforeEach, describe, expect, it } from 'vitest';
import { createHlcState, makeDelete, makeUpsert, tickHlc } from '@converge/core';
import { materializeChange, materializeChanges, type MaterializerAdapter } from '@converge/materialize-core';
import { createCustomMaterializer, createSqlExecutor } from './adapter';
import type { Db } from './types';
import { createSqliteDb, type TestSchema } from './test-helpers';

describe('createCustomMaterializer - SQLite dialect', () => {
  let db: Db;
  let adapter: MaterializerAdapter<TestSchema>;

  beforeEach(async () => {
    db = createSqliteDb();
    // Create entity table
    await db.run(
      'CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER)',
      [],
    );
    const sqlConfig = {
      dialect: 'sqlite',
      tableMap: { todos: 'todos' },
    } as const;
    adapter = createCustomMaterializer<TestSchema>({
      tableMap: sqlConfig.tableMap,
      executor: createSqlExecutor(sqlConfig, db),
    });
  });

  it('creates tags table on first use', async () => {
    const hlc = tickHlc(createHlcState('node-1'), 100);
    const change = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { id: 'todo-1', title: 'Buy milk', done: false },
      hlc,
    });

    await materializeChange(adapter, change);

    // Verify tags table exists and has data
    const row = await db.get<{ data: string; tags: string; deleted: number }>(
      'SELECT data, tags, deleted FROM converge_tags WHERE entity = ? AND id = ?',
      ['todos', 'todo-1'],
    );
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.data)).toEqual({ id: 'todo-1', title: 'Buy milk', done: false });
    expect(row!.deleted).toBe(0);
  });

  it('saves entity to both tags table and entity table', async () => {
    const sqlConfig = {
      dialect: 'sqlite',
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

    // Check entity table
    const entityRow = await db.get<{ id: string; title: string; done: number }>(
      'SELECT id, title, done FROM todos WHERE id = ?',
      ['todo-1'],
    );
    expect(entityRow).toEqual({ id: 'todo-1', title: 'Buy milk', done: 0 });
  });

  it('uses field mapping when provided', async () => {
    const db2 = createSqliteDb();
    await db2.run(
      'CREATE TABLE todos (id TEXT PRIMARY KEY, todo_title TEXT, is_done INTEGER)',
      [],
    );
    const sqlConfig = {
      dialect: 'sqlite',
      tableMap: { todos: 'todos' },
      fieldMap: { todos: { id: 'id', title: 'todo_title', done: 'is_done' } },
    } as const;
    const adapter2 = createCustomMaterializer<TestSchema>({
      tableMap: sqlConfig.tableMap,
      fieldMap: sqlConfig.fieldMap,
      executor: createSqlExecutor(sqlConfig, db2),
    });

    const hlc = tickHlc(createHlcState('node-1'), 100);
    const change = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { id: 'todo-1', title: 'Buy milk', done: false },
      hlc,
    });

    await materializeChange(adapter2, change);

    const row = await db2.get<{ id: string; todo_title: string; is_done: number }>(
      'SELECT id, todo_title, is_done FROM todos WHERE id = ?',
      ['todo-1'],
    );
    expect(row).toEqual({ id: 'todo-1', todo_title: 'Buy milk', is_done: 0 });
  });

  it('loads existing state', async () => {
    const hlc1 = tickHlc(createHlcState('node-1'), 100);
    const change1 = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { id: 'todo-1', title: 'Buy milk', done: false },
      hlc: hlc1,
    });
    await materializeChange(adapter, change1);

    const state = await adapter.load('todos', 'todo-1');
    expect(state).toBeTruthy();
    expect(state!.values).toEqual({ id: 'todo-1', title: 'Buy milk', done: false });
    expect(state!.tags.title).toBe(hlc1);
    expect(state!.deleted).toBe(false);
  });

  it('handles deletes', async () => {
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
    const change2 = makeDelete<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      hlc: hlc2,
    });
    const result = await materializeChange(adapter, change2);
    expect(result).toBe('removed');

    const state = await adapter.load('todos', 'todo-1');
    expect(state).toBeTruthy();
    expect(state!.deleted).toBe(true);
    expect(state!.deletedTag).toBe(hlc2);
  });

  it('handles multiple changes', async () => {
    const hlc1 = tickHlc(createHlcState('node-1'), 100);
    const hlc2 = tickHlc(createHlcState('node-1'), 101);
    const hlc3 = tickHlc(createHlcState('node-1'), 102);

    const changes = [
      makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todos',
        entityId: 'todo-1',
        patch: { id: 'todo-1', title: 'Buy milk', done: false },
        hlc: hlc1,
      }),
      makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todos',
        entityId: 'todo-1',
        patch: { done: true },
        hlc: hlc2,
      }),
      makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todos',
        entityId: 'todo-2',
        patch: { id: 'todo-2', title: 'Buy bread', done: false },
        hlc: hlc3,
      }),
    ];

    await materializeChanges(adapter, changes);

    const state1 = await adapter.load('todos', 'todo-1');
    expect(state1!.values).toEqual({ id: 'todo-1', title: 'Buy milk', done: true });

    const state2 = await adapter.load('todos', 'todo-2');
    expect(state2!.values).toEqual({ id: 'todo-2', title: 'Buy bread', done: false });
  });

  it('throws error for missing table mapping', async () => {
    const sqlConfig = {
      dialect: 'sqlite',
      tableMap: {} as Record<keyof TestSchema, string>,
    };
    const badAdapter = createCustomMaterializer<TestSchema>({
      tableMap: sqlConfig.tableMap,
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

    await expect(materializeChange(badAdapter, change)).rejects.toThrow('No table mapping for entity: todos');
  });

  it('throws error for invalid dialect', () => {
    expect(() => {
      const sqlConfig = {
        dialect: 'invalid-dialect' as 'sqlite',
        tableMap: { todos: 'todos' },
      };
      createCustomMaterializer<TestSchema>({
        tableMap: sqlConfig.tableMap,
        executor: createSqlExecutor(sqlConfig, db),
      });
    }).toThrow('Invalid config: must provide dialect or custom commands');
  });
});
