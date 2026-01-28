import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClientQueryApi } from './index';
import { MemoryStore } from '@rippledb/store-memory';
import { defineSchema } from '@rippledb/core';
import { QueryClient } from '@tanstack/query-core';
import { defineListRegistry } from '@rippledb/bind-tanstack-query';

type TestSchema = {
  todos: { id: string; title: string; done: boolean };
  users: { id: string; name: string; email: string };
};

describe('createClientQueryApi', () => {
  let queryClient: QueryClient;
  let store: MemoryStore<TestSchema>;
  let schema: ReturnType<typeof defineSchema<TestSchema>>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    store = new MemoryStore<TestSchema>();
    schema = defineSchema({
      todos: { id: '', title: '', done: false },
      users: { id: '', name: '', email: '' },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    queryClient.clear();
    vi.useRealTimers();
  });

  it('creates dynamic entity controllers from schema', () => {
    const api = createClientQueryApi({
      store,
      stream: 'test-stream',
      queryClient,
      schema,
    });

    expect(api.todos).toBeDefined();
    expect(api.users).toBeDefined();
    expect(typeof api.todos.create).toBe('function');
    expect(typeof api.todos.read).toBe('function');
    expect(typeof api.todos.update).toBe('function');
    expect(typeof api.todos.delete).toBe('function');
    expect(typeof api.todos.list).toBe('function');
  });

  it('can create entities using dynamic controllers', async () => {
    const api = createClientQueryApi({
      store,
      stream: 'test-stream',
      queryClient,
      schema,
    });

    const todo = await api.todos.create({ title: 'Buy milk', done: false });
    expect(todo.id).toBeDefined();
    expect(todo.title).toBe('Buy milk');
    expect(todo.done).toBe(false);

    const user = await api.users.create({ name: 'John', email: 'john@example.com' });
    expect(user.id).toBeDefined();
    expect(user.name).toBe('John');
    expect(user.email).toBe('john@example.com');
  });

  it('can read entities using dynamic controllers', async () => {
    const api = createClientQueryApi({
      store,
      stream: 'test-stream',
      queryClient,
      schema,
    });

    const created = await api.todos.create({ title: 'Test', done: false });
    const read = await api.todos.read(created.id);

    expect(read).toEqual(created);
  });

  it('can update entities using dynamic controllers', async () => {
    const api = createClientQueryApi({
      store,
      stream: 'test-stream',
      queryClient,
      schema,
    });

    const created = await api.todos.create({ title: 'Test', done: false });
    const updated = await api.todos.update(created.id, { done: true });

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe('Test');
    expect(updated.done).toBe(true);
  });

  it('can delete entities using dynamic controllers', async () => {
    const api = createClientQueryApi({
      store,
      stream: 'test-stream',
      queryClient,
      schema,
    });

    const created = await api.todos.create({ title: 'Test', done: false });
    await api.todos.delete(created.id);

    const read = await api.todos.read(created.id);
    expect(read).toBeNull();
  });

  it('provides query helper that executes query function', async () => {
    const api = createClientQueryApi({
      store,
      stream: 'test-stream',
      queryClient,
      schema,
    });

    await api.todos.create({ title: 'Test', done: false });

    const result = await api.query({
      key: ['todos'],
      deps: ['todos'],
      fn: async () => {
        return await api.todos.list({ entity: 'todos' });
      },
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('provides cleanup function', () => {
    const api = createClientQueryApi({
      store,
      stream: 'test-stream',
      queryClient,
      schema,
    });

    expect(typeof api.cleanup).toBe('function');
    
    // Should not throw
    expect(() => api.cleanup()).not.toThrow();
  });

  it('works with provided registry', () => {
    const registry = defineListRegistry().list(['todos'], { deps: ['todos'] });

    const api = createClientQueryApi({
      store,
      stream: 'test-stream',
      queryClient,
      schema,
      registry,
    });

    expect(api.todos).toBeDefined();
    expect(typeof api.cleanup).toBe('function');
  });
});
