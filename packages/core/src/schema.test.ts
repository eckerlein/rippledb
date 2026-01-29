import { describe, it, expect, expectTypeOf } from 'vitest';
import { defineSchema, s, type InferSchema } from './schema';

describe('defineSchema', () => {
  it('creates a schema descriptor with entity discovery', () => {
    const schema = defineSchema({
      todos: { id: s.string(), title: s.string(), done: s.boolean() },
      users: { id: s.string(), name: s.string(), email: s.string() },
    });

    expect(schema.entities).toEqual(['todos', 'users']);
    expect(schema.entityMap.has('todos')).toBe(true);
    expect(schema.entityMap.has('users')).toBe(true);
    // Testing invalid entity name at runtime
    expect(schema.entityMap.has('comments' as 'todos')).toBe(false);
  });

  it('tracks entity properties at runtime', () => {
    const schema = defineSchema({
      todos: { id: s.string(), title: s.string(), done: s.boolean() },
      users: { id: s.string(), name: s.string(), email: s.string() },
    });

    expect(schema.getFields('todos')).toEqual(['id', 'title', 'done']);
    expect(schema.getFields('users')).toEqual(['id', 'name', 'email']);
  });

  it('can check if entity has a field', () => {
    const schema = defineSchema({
      todos: { id: s.string(), title: s.string(), done: s.boolean() },
      users: { id: s.string(), name: s.string(), email: s.string() },
    });

    expect(schema.hasField('todos', 'title')).toBe(true);
    expect(schema.hasField('todos', 'done')).toBe(true);
    expect(schema.hasField('todos', 'missing')).toBe(false);
    expect(schema.hasField('users', 'email')).toBe(true);
    expect(schema.hasField('users', 'title')).toBe(false);
  });

  it('provides field descriptor access at runtime', () => {
    const schema = defineSchema({
      todos: { 
        id: s.string(), 
        title: s.string(), 
        done: s.boolean(),
        status: s.enum(['pending', 'active', 'done'] as const),
      },
    });

    expect(schema.getFieldDescriptor('todos', 'id')?._type).toBe('string');
    expect(schema.getFieldDescriptor('todos', 'done')?._type).toBe('boolean');
    expect(schema.getFieldDescriptor('todos', 'status')?._type).toBe('enum');
    
    const statusField = schema.getFieldDescriptor('todos', 'status');
    if (statusField?._type === 'enum') {
      expect(statusField.values).toEqual(['pending', 'active', 'done']);
    }
  });

  it('preserves schema type for type inference', () => {
    const schema = defineSchema({
      todos: { id: s.string(), title: s.string(), done: s.boolean() },
      users: { id: s.string(), name: s.string(), email: s.string() },
    });

    // Runtime check to use schema value
    expect(schema.entities).toEqual(['todos', 'users']);

    // Type check: InferSchema should produce the correct types
    type MySchema = InferSchema<typeof schema>;
    
    // These type assertions verify the inference works
    expectTypeOf<MySchema['todos']>().toEqualTypeOf<{
      id: string;
      title: string;
      done: boolean;
    }>();
    
    expectTypeOf<MySchema['users']>().toEqualTypeOf<{
      id: string;
      name: string;
      email: string;
    }>();
  });

  it('infers enum types correctly', () => {
    const schema = defineSchema({
      todos: {
        id: s.string(),
        status: s.enum(['pending', 'active', 'done'] as const),
      },
    });

    expect(schema.entities).toContain('todos');

    type MySchema = InferSchema<typeof schema>;
    
    // Status should be a union of the enum values
    expectTypeOf<MySchema['todos']['status']>().toEqualTypeOf<'pending' | 'active' | 'done'>();
  });

  it('infers optional fields correctly', () => {
    const schema = defineSchema({
      todos: {
        id: s.string(),
        title: s.string(),
        notes: s.string().optional(),
        priority: s.number().optional(),
      },
    });

    expect(schema.getFields('todos')).toContain('notes');

    type MySchema = InferSchema<typeof schema>;
    
    // Required fields
    expectTypeOf<MySchema['todos']['id']>().toEqualTypeOf<string>();
    expectTypeOf<MySchema['todos']['title']>().toEqualTypeOf<string>();
    
    // Optional fields
    expectTypeOf<MySchema['todos']['notes']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<MySchema['todos']['priority']>().toEqualTypeOf<number | undefined>();
  });

  it('provides empty extensions map initially', () => {
    const schema = defineSchema({
      todos: { id: s.string(), title: s.string() },
    });

    expect(schema.extensions.size).toBe(0);
  });

  it('allows attaching extensions', () => {
    const schema = defineSchema({
      todos: { id: s.string(), title: s.string() },
      users: { id: s.string(), name: s.string() },
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
      todos: { id: s.string(), title: s.string() },
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
      todos: { id: s.string(), title: s.string() },
      users: { id: s.string(), name: s.string() },
    });

    expect(() => {
      (schema.entities as string[]).push('comments');
    }).toThrow();
  });

  it('preserves immutability of fields array', () => {
    const schema = defineSchema({
      todos: { id: s.string(), title: s.string(), done: s.boolean() },
    });

    const fields = schema.getFields('todos');
    expect(() => {
      (fields as string[]).push('newField');
    }).toThrow();
  });

  it('works with single entity', () => {
    const schema = defineSchema({
      todos: { id: s.string(), title: s.string() },
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

describe('field descriptor builders', () => {
  it('s.string() creates a string field descriptor', () => {
    const field = s.string();
    expect(field._type).toBe('string');
    expect(field._optional).toBe(false);
  });

  it('s.number() creates a number field descriptor', () => {
    const field = s.number();
    expect(field._type).toBe('number');
    expect(field._optional).toBe(false);
  });

  it('s.boolean() creates a boolean field descriptor', () => {
    const field = s.boolean();
    expect(field._type).toBe('boolean');
    expect(field._optional).toBe(false);
  });

  it('s.enum() creates an enum field descriptor', () => {
    const field = s.enum(['a', 'b', 'c']);
    expect(field._type).toBe('enum');
    expect(field.values).toEqual(['a', 'b', 'c']);
    expect(field._optional).toBe(false);
  });

  it('.optional() marks field as optional', () => {
    const stringField = s.string().optional();
    expect(stringField._type).toBe('string');
    expect(stringField._optional).toBe(true);

    const numberField = s.number().optional();
    expect(numberField._type).toBe('number');
    expect(numberField._optional).toBe(true);

    const boolField = s.boolean().optional();
    expect(boolField._type).toBe('boolean');
    expect(boolField._optional).toBe(true);

    const enumField = s.enum(['x', 'y']).optional();
    expect(enumField._type).toBe('enum');
    expect(enumField.values).toEqual(['x', 'y']);
    expect(enumField._optional).toBe(true);
  });
});
