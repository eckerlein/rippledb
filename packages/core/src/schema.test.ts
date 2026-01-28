import { describe, it, expect } from 'vitest';
import { defineSchema } from './schema';

describe('defineSchema', () => {
  it('creates a schema descriptor with entity discovery', () => {
    const schema = defineSchema({
      todos: { id: '', title: '', done: false },
      users: { id: '', name: '', email: '' },
    });

    expect(schema.entities).toEqual(['todos', 'users']);
    expect(schema.entityMap.has('todos')).toBe(true);
    expect(schema.entityMap.has('users')).toBe(true);
    // @ts-expect-error - testing invalid entity name
    expect(schema.entityMap.has('comments')).toBe(false);
  });

  it('tracks entity properties at runtime', () => {
    const schema = defineSchema({
      todos: { id: '', title: '', done: false },
      users: { id: '', name: '', email: '' },
    });

    expect(schema.getFields('todos')).toEqual(['id', 'title', 'done']);
    expect(schema.getFields('users')).toEqual(['id', 'name', 'email']);
    // @ts-expect-error - testing invalid entity name
    expect(schema.getFields('comments')).toEqual([]);
  });

  it('can check if entity has a field', () => {
    const schema = defineSchema({
      todos: { id: '', title: '', done: false },
      users: { id: '', name: '', email: '' },
    });

    expect(schema.hasField('todos', 'title')).toBe(true);
    expect(schema.hasField('todos', 'done')).toBe(true);
    expect(schema.hasField('todos', 'missing')).toBe(false);
    expect(schema.hasField('users', 'email')).toBe(true);
    expect(schema.hasField('users', 'title')).toBe(false);
  });

  it('preserves schema type for type inference', () => {
    const schema = defineSchema({
      todos: { id: '', title: '', done: false },
      users: { id: '', name: '', email: '' },
    });

    // Type check: schema.schema should preserve the structure
    type InferredSchema = typeof schema.schema;
    const _test: InferredSchema = schema.schema;
    expect(_test).toBeDefined();
    expect(_test.todos).toBeDefined();
    expect(_test.users).toBeDefined();
    expect(_test.todos.id).toBeDefined();
    expect(_test.users.email).toBeDefined();
  });

  it('provides empty extensions map initially', () => {
    const schema = defineSchema({
      todos: { id: '', title: '' },
    });

    expect(schema.extensions.size).toBe(0);
  });

  it('allows attaching extensions', () => {
    const schema = defineSchema({
      todos: { id: '', title: '' },
      users: { id: '', name: '' },
    });

    const zodExtension = {
      todos: { parse: () => ({}) },
      users: { parse: () => ({}) },
    };

    const schemaWithZod = schema.extend('zod', zodExtension);

    expect(schemaWithZod.extensions.size).toBe(1);
    expect(schemaWithZod.extensions.get('zod')).toEqual(zodExtension);
    expect(schemaWithZod.entities).toEqual(['todos', 'users']); // Preserves entities
  });

  it('allows multiple extensions', () => {
    const schema = defineSchema({
      todos: { id: '', title: '' },
    });

    const zodExtension = { todos: {} };
    const drizzleExtension = { tableMap: { todos: 'todos_table' } };

    const schemaWithBoth = schema
      .extend('zod', zodExtension)
      .extend('drizzle', drizzleExtension);

    expect(schemaWithBoth.extensions.size).toBe(2);
    expect(schemaWithBoth.extensions.get('zod')).toEqual(zodExtension);
    expect(schemaWithBoth.extensions.get('drizzle')).toEqual(drizzleExtension);
  });

  it('preserves immutability of entities array', () => {
    const schema = defineSchema({
      todos: { id: '', title: '' },
      users: { id: '', name: '' },
    });

    expect(() => {
      (schema.entities as string[]).push('comments');
    }).toThrow();
  });

  it('preserves immutability of fields array', () => {
    const schema = defineSchema({
      todos: { id: '', title: '', done: false },
    });

    const fields = schema.getFields('todos');
    expect(() => {
      (fields as string[]).push('newField');
    }).toThrow();
  });

  it('works with single entity', () => {
    const schema = defineSchema({
      todos: { id: '', title: '' },
    });

    expect(schema.entities).toEqual(['todos']);
    expect(schema.entityMap.size).toBe(1);
    expect(schema.getFields('todos')).toEqual(['id', 'title']);
  });

  it('works with empty schema', () => {
    const schema = defineSchema({});

    expect(schema.entities).toEqual([]);
    expect(schema.entityMap.size).toBe(0);
  });
});
