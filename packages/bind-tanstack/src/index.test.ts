import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  defineListRegistry,
  wireTanstackInvalidation,
} from './index';
import { MemoryStore } from '@rippledb/store-memory';
import { makeUpsert, makeDelete, createHlcState, tickHlc } from '@rippledb/core';
import type { QueryClient } from '@tanstack/query-core';

type TestSchema = {
  todos: { id: string; title: string };
  tags: { id: string; name: string };
  users: { id: string; name: string };
};

// Mock QueryClient
function createMockQueryClient() {
  return {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } as unknown as QueryClient;
}

// Helper to create a store and HLC state
function createTestStore() {
  const store = new MemoryStore<TestSchema>();
  const hlcState = createHlcState('test-node');
  let now = Date.now();

  return {
    store,
    // Helper to emit an upsert event (makeUpsert auto-generates tags)
    async upsert(
      entity: 'todos' | 'tags' | 'users',
      id: string,
      patch: Record<string, unknown>,
    ) {
      const hlc = tickHlc(hlcState, now++);
      await store.applyChanges([
        makeUpsert({
          stream: 'test-stream',
          entity,
          entityId: id,
          patch,
          hlc,
        }),
      ]);
    },
    // Helper to emit a delete event
    async delete(entity: 'todos' | 'tags' | 'users', id: string) {
      const hlc = tickHlc(hlcState, now++);
      await store.applyChanges([
        makeDelete({
          stream: 'test-stream',
          entity,
          entityId: id,
          hlc,
        }),
      ]);
    },
  };
}

describe('defineListRegistry', () => {
  it('creates an empty registry', () => {
    const registry = defineListRegistry();
    expect(registry.entries).toEqual([]);
  });

  it('registers list queries with deps', () => {
    const registry = defineListRegistry()
      .list(['todos'], { deps: ['todos'] })
      .list(['dashboard'], { deps: ['todos', 'users', 'tags'] });

    expect(registry.entries).toHaveLength(2);
    expect(registry.entries[0]).toEqual({
      queryKey: ['todos'],
      deps: ['todos'],
    });
    expect(registry.entries[1]).toEqual({
      queryKey: ['dashboard'],
      deps: ['todos', 'users', 'tags'],
    });
  });

  it('supports complex query keys', () => {
    const registry = defineListRegistry().list(['todos', { status: 'active' }], {
      deps: ['todos'],
    });

    expect(registry.entries[0].queryKey).toEqual(['todos', { status: 'active' }]);
  });
});

describe('wireTanstackInvalidation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws if no store or onEvent provided', () => {
    const queryClient = createMockQueryClient();
    expect(() =>
      wireTanstackInvalidation({ queryClient }),
    ).toThrowError('either `store` (with onEvent) or `onEvent` callback is required');
  });

  it('invalidates entity queries on event', async () => {
    const queryClient = createMockQueryClient();
    const { store, upsert } = createTestStore();

    wireTanstackInvalidation({
      queryClient,
      store,
      debounceMs: 0,
    });

    await upsert('todos', '1', { title: 'Test' });

    // Should invalidate [todos] and [todos, 1]
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['todos', '1'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['todos'],
    });
  });

  it('invalidates list queries based on registry', async () => {
    const queryClient = createMockQueryClient();
    const { store, upsert } = createTestStore();
    const registry = defineListRegistry()
      .list(['todoList'], { deps: ['todos'] })
      .list(['dashboard'], { deps: ['todos', 'users'] });

    wireTanstackInvalidation({
      queryClient,
      store,
      registry,
      debounceMs: 0,
    });

    await upsert('todos', '1', { title: 'Updated' });

    // Should invalidate both todoList and dashboard (both depend on todos)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['todoList'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard'],
    });
  });

  it('does not invalidate unrelated list queries', async () => {
    const queryClient = createMockQueryClient();
    const { store, upsert } = createTestStore();
    const registry = defineListRegistry()
      .list(['todoList'], { deps: ['todos'] })
      .list(['userList'], { deps: ['users'] });

    wireTanstackInvalidation({
      queryClient,
      store,
      registry,
      debounceMs: 0,
    });

    await upsert('tags', '1', { name: 'test-tag' });

    // Should NOT invalidate todoList or userList (neither depends on tags)
    expect(queryClient.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['todoList'],
    });
    expect(queryClient.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['userList'],
    });
    // Should still invalidate [tags] and [tags, 1]
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['tags'],
    });
  });

  it('debounces multiple events', async () => {
    const queryClient = createMockQueryClient();
    const { store, upsert } = createTestStore();

    wireTanstackInvalidation({
      queryClient,
      store,
      debounceMs: 50,
    });

    // Emit multiple events rapidly (all sync, before timer fires)
    await upsert('todos', '1', { title: 'First' });
    await upsert('todos', '2', { title: 'Second' });
    await upsert('users', '1', { name: 'Alice' });

    // Nothing invalidated yet (debouncing)
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    // Fast-forward time
    vi.advanceTimersByTime(50);

    // Now should have invalidated (coalesced)
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
    // Should have invalidated todos, users, and individual rows
    const calls = (queryClient.invalidateQueries as ReturnType<typeof vi.fn>).mock.calls;
    const queryKeys = calls.map((c) => c[0].queryKey);

    expect(queryKeys).toContainEqual(['todos']);
    expect(queryKeys).toContainEqual(['users']);
    expect(queryKeys).toContainEqual(['todos', '1']);
    expect(queryKeys).toContainEqual(['todos', '2']);
    expect(queryKeys).toContainEqual(['users', '1']);
  });

  it('can disable row invalidation', async () => {
    const queryClient = createMockQueryClient();
    const { store, upsert } = createTestStore();

    wireTanstackInvalidation({
      queryClient,
      store,
      debounceMs: 0,
      invalidateRows: false,
    });

    await upsert('todos', '1', { title: 'Test' });

    // Should NOT invalidate [todos, 1]
    expect(queryClient.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['todos', '1'],
    });
    // Should still invalidate [todos]
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['todos'],
    });
  });

  it('cleanup stops listening', async () => {
    const queryClient = createMockQueryClient();
    const { store, upsert } = createTestStore();

    const cleanup = wireTanstackInvalidation({
      queryClient,
      store,
      debounceMs: 0,
    });

    // Cleanup
    cleanup();

    // Emit event after cleanup
    await upsert('todos', '1', { title: 'Test' });

    // Should NOT invalidate (unsubscribed)
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});
