import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHlcState, makeDelete, makeUpsert, tickHlc } from '@converge/core';
import { materializeChange } from '@converge/materialize-core';
import { createCustomMaterializer } from '@converge/materialize-db';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { getTableConfig, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { createDrizzleMaterializerConfig } from './index';

type TestSchema = {
  todos: {
    id: string;
    title: string;
    done: boolean;
  };
};

const todosTable = sqliteTable('todos', {
  id: text('id').primaryKey(),
  title: text('title'),
  done: integer('done'),
});

const tagsTable = sqliteTable('converge_tags', {
  entity: text('entity').notNull(),
  id: text('id').notNull(),
  data: text('data').notNull(),
  tags: text('tags').notNull(),
  deleted: integer('deleted').notNull().default(0),
  deleted_tag: text('deleted_tag'),
});

describe('materialize-drizzle (sqlite)', () => {
  let dbPath: string;
  let sqlite: Database.Database;

  beforeEach(() => {
    dbPath = join(tmpdir(), `drizzle-sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    sqlite = new Database(dbPath);
    sqlite.exec(`
      CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, done INTEGER);
      CREATE TABLE converge_tags (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        tags TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        deleted_tag TEXT,
        PRIMARY KEY (entity, id)
      );
    `);
  });

  afterEach(() => {
    sqlite.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('materializes upserts into tags and entity tables', async () => {
    const db = drizzle(sqlite);
    const config = createDrizzleMaterializerConfig<TestSchema>({
      db,
      tableMap: { todos: todosTable },
      tagsTableDef: tagsTable,
      getTableConfig: (table) => getTableConfig(table as typeof todosTable),
      fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
      normalizeValue: (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value),
    });
    const adapter = createCustomMaterializer<TestSchema>(config);

    const hlc = tickHlc(createHlcState('node-1'), 100);
    const change = makeUpsert<TestSchema>({
      stream: 'test',
      entity: 'todos',
      entityId: 'todo-1',
      patch: { id: 'todo-1', title: 'Buy milk', done: false },
      hlc,
    });

    await materializeChange(adapter, change);

    const tagsRow = sqlite
      .prepare('SELECT data, tags, deleted FROM converge_tags WHERE entity = ? AND id = ?')
      .get('todos', 'todo-1') as { data: string; tags: string; deleted: number } | undefined;
    expect(tagsRow).toBeTruthy();
    expect(JSON.parse(tagsRow!.data)).toEqual({ id: 'todo-1', title: 'Buy milk', done: false });
    expect(tagsRow!.deleted).toBe(0);

    const todoRow = sqlite
      .prepare('SELECT id, title, done FROM todos WHERE id = ?')
      .get('todo-1') as { id: string; title: string; done: number } | undefined;
    expect(todoRow).toEqual({ id: 'todo-1', title: 'Buy milk', done: 0 });
  });

  it('handles deletes by marking tags', async () => {
    const db = drizzle(sqlite);
    const config = createDrizzleMaterializerConfig<TestSchema>({
      db,
      tableMap: { todos: todosTable },
      tagsTableDef: tagsTable,
      getTableConfig: (table) => getTableConfig(table as typeof todosTable),
      fieldMap: { todos: { id: 'id', title: 'title', done: 'done' } },
      normalizeValue: (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value),
    });
    const adapter = createCustomMaterializer<TestSchema>(config);

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
    await materializeChange(adapter, change2);

    const tagsRow = sqlite
      .prepare('SELECT deleted, deleted_tag FROM converge_tags WHERE entity = ? AND id = ?')
      .get('todos', 'todo-1') as { deleted: number; deleted_tag: string | null } | undefined;
    expect(tagsRow).toBeTruthy();
    expect(tagsRow!.deleted).toBe(1);
    expect(tagsRow!.deleted_tag).toBeTruthy();
  });
});
