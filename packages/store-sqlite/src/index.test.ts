import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from './index';
import { tickHlc, createHlcState, makeUpsert, makeDelete, defineSchema, s } from '@rippledb/core';

const testSchema = defineSchema({
  todos: {
    id: s.string(),
    title: s.string(),
  },
});

describe('SqliteStore', () => {
  let store: SqliteStore<typeof testSchema>;

  beforeEach(() => {
    store = new SqliteStore<typeof testSchema>({ 
      filename: ':memory:', 
      schema: testSchema,
    });
  });

  afterEach(() => {
    store.close();
  });

  describe('getRows', () => {
    it('returns multiple rows for existing ids and skips missing ones', async () => {
      const state = createHlcState('test-node');
      let now = Date.now();

      await store.applyChanges([
        makeUpsert({
          stream: 's',
          entity: 'todos',
          entityId: '1',
          patch: { id: '1', title: 'One' },
          hlc: tickHlc(state, now++),
        }),
        makeUpsert({
          stream: 's',
          entity: 'todos',
          entityId: '2',
          patch: { id: '2', title: 'Two' },
          hlc: tickHlc(state, now++),
        }),
      ]);

      const rows = await store.getRows('todos', ['1', '2', 'missing']);

      expect(rows.size).toBe(2);
      expect(rows.get('1')).toEqual({ id: '1', title: 'One' });
      expect(rows.get('2')).toEqual({ id: '2', title: 'Two' });
      expect(rows.has('missing')).toBe(false);
    });

    it('does not return deleted rows', async () => {
      const state = createHlcState('test-node');
      let now = Date.now();

      await store.applyChanges([
        makeUpsert({
          stream: 's',
          entity: 'todos',
          entityId: '1',
          patch: { id: '1', title: 'One' },
          hlc: tickHlc(state, now++),
        }),
      ]);

      // Delete the row
      await store.applyChanges([
        makeDelete({
          stream: 's',
          entity: 'todos',
          entityId: '1',
          hlc: tickHlc(state, now++),
        }),
      ]);

      const rows = await store.getRows('todos', ['1']);
      expect(rows.size).toBe(0);
    });
  });

  describe('getRow', () => {
    it('returns a single row by id', async () => {
      const state = createHlcState('test-node');
      let now = Date.now();

      await store.applyChanges([
        makeUpsert({
          stream: 's',
          entity: 'todos',
          entityId: '1',
          patch: { id: '1', title: 'One' },
          hlc: tickHlc(state, now++),
        }),
      ]);

      const row = await store.getRow('todos', '1');
      expect(row).toEqual({ id: '1', title: 'One' });
    });

    it('returns null for missing row', async () => {
      const row = await store.getRow('todos', 'missing');
      expect(row).toBeNull();
    });

    it('returns null for deleted row', async () => {
      const state = createHlcState('test-node');
      let now = Date.now();

      await store.applyChanges([
        makeUpsert({
          stream: 's',
          entity: 'todos',
          entityId: '1',
          patch: { id: '1', title: 'One' },
          hlc: tickHlc(state, now++),
        }),
        makeDelete({
          stream: 's',
          entity: 'todos',
          entityId: '1',
          hlc: tickHlc(state, now++),
        }),
      ]);

      const row = await store.getRow('todos', '1');
      expect(row).toBeNull();
    });
  });

  describe('listRows', () => {
    it('returns all non-deleted rows for an entity', async () => {
      const state = createHlcState('test-node');
      let now = Date.now();

      await store.applyChanges([
        makeUpsert({
          stream: 's',
          entity: 'todos',
          entityId: '1',
          patch: { id: '1', title: 'One' },
          hlc: tickHlc(state, now++),
        }),
        makeUpsert({
          stream: 's',
          entity: 'todos',
          entityId: '2',
          patch: { id: '2', title: 'Two' },
          hlc: tickHlc(state, now++),
        }),
        makeUpsert({
          stream: 's',
          entity: 'todos',
          entityId: '3',
          patch: { id: '3', title: 'Three' },
          hlc: tickHlc(state, now++),
        }),
      ]);

      const rows = await store.listRows('SELECT id, title FROM todos WHERE deleted = 0');
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.id)).toEqual(['1', '2', '3']);
    });

    it('excludes deleted rows', async () => {
      const state = createHlcState('test-node');
      let now = Date.now();

      await store.applyChanges([
        makeUpsert({
          stream: 's',
          entity: 'todos',
          entityId: '1',
          patch: { id: '1', title: 'One' },
          hlc: tickHlc(state, now++),
        }),
        makeUpsert({
          stream: 's',
          entity: 'todos',
          entityId: '2',
          patch: { id: '2', title: 'Two' },
          hlc: tickHlc(state, now++),
        }),
        makeDelete({
          stream: 's',
          entity: 'todos',
          entityId: '2',
          hlc: tickHlc(state, now++),
        }),
      ]);

      const rows = await store.listRows('SELECT id, title FROM todos WHERE deleted = 0');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('1');
    });
  });

  describe('onEvent', () => {
    it('emits events when changes are applied', async () => {
      const events: Array<{ entity: string; kind: string; id?: string }> = [];
      const unsubscribe = store.onEvent((event) => {
        events.push(event);
      });

      const state = createHlcState('test-node');
      let now = Date.now();

      await store.applyChanges([
        makeUpsert({
          stream: 's',
          entity: 'todos',
          entityId: '1',
          patch: { id: '1', title: 'One' },
          hlc: tickHlc(state, now++),
        }),
        makeDelete({
          stream: 's',
          entity: 'todos',
          entityId: '1',
          hlc: tickHlc(state, now++),
        }),
      ]);

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ entity: 'todos', kind: 'insert', id: '1' });
      expect(events[1]).toEqual({ entity: 'todos', kind: 'delete', id: '1' });

      unsubscribe();
    });
  });
});
