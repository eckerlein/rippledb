import { describe, expect, it } from 'vitest';
import { makeUpsert, makeDelete, createHlcState, tickHlc, defineSchema, s } from '@rippledb/core';
import type { Change } from '@rippledb/core';
import type { PullRequest, AppendRequest, AppendResult, PullResponse } from '@rippledb/server';
import {
  hlcSchema,
  changeSchema,
  pullRequestSchema,
  appendRequestSchema,
  appendResultSchema,
  pullResponseSchema,
  createChangeSchema,
  withZod,
  generateZodSchemas,
} from './index';
import { z } from 'zod';

type TestSchema = {
  todo: { id: string; title: string; done: boolean };
};

function makeHlc(nodeId: string, nowMs: number) {
  const state = createHlcState(nodeId);
  return tickHlc(state, nowMs);
}

describe('@rippledb/zod', () => {
  describe('hlcSchema', () => {
    it('validates correct HLC format', () => {
      const hlc = makeHlc('node1', 1000);
      expect(hlcSchema.safeParse(hlc).success).toBe(true);
    });

    it('rejects invalid HLC format', () => {
      expect(hlcSchema.safeParse('invalid').success).toBe(false);
      expect(hlcSchema.safeParse('123').success).toBe(false);
      expect(hlcSchema.safeParse(123).success).toBe(false);
    });
  });

  describe('changeSchema', () => {
    it('validates upsert changes from @rippledb/core', () => {
      const change: Change<TestSchema> = makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todo',
        entityId: '1',
        patch: { id: '1', title: 'Hello', done: false },
        hlc: makeHlc('node1', 1000),
      });

      const result = changeSchema.safeParse(change);
      expect(result.success).toBe(true);
    });

    it('validates delete changes from @rippledb/core', () => {
      const change: Change<TestSchema> = makeDelete<TestSchema>({
        stream: 'test',
        entity: 'todo',
        entityId: '1',
        hlc: makeHlc('node1', 1000),
      });

      const result = changeSchema.safeParse(change);
      expect(result.success).toBe(true);
    });
  });

  describe('createChangeSchema', () => {
    it('validates typed changes with custom schema', () => {
      const todoSchema = z.object({
        id: z.string(),
        title: z.string(),
        done: z.boolean(),
      });
      const todoChangeSchema = createChangeSchema(todoSchema);

      const change: Change<TestSchema> = makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todo',
        entityId: '1',
        patch: { title: 'Hello' },
        hlc: makeHlc('node1', 1000),
      });

      const result = todoChangeSchema.safeParse(change);
      expect(result.success).toBe(true);
    });
  });

  describe('pullRequestSchema', () => {
    it('validates PullRequest from @rippledb/server', () => {
      const req: PullRequest = {
        stream: 'test',
        cursor: null,
        limit: 100,
      };

      const result = pullRequestSchema.safeParse(req);
      expect(result.success).toBe(true);
    });

    it('validates PullRequest with cursor', () => {
      const req: PullRequest = {
        stream: 'test',
        cursor: 'abc123',
      };

      const result = pullRequestSchema.safeParse(req);
      expect(result.success).toBe(true);
    });
  });

  describe('pullResponseSchema', () => {
    it('validates PullResponse from @rippledb/server', () => {
      const change: Change<TestSchema> = makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todo',
        entityId: '1',
        patch: { id: '1', title: 'Hello', done: false },
        hlc: makeHlc('node1', 1000),
      });

      const res: PullResponse<TestSchema> = {
        changes: [change],
        nextCursor: 'cursor123',
      };

      const result = pullResponseSchema.safeParse(res);
      expect(result.success).toBe(true);
    });
  });

  describe('appendRequestSchema', () => {
    it('validates AppendRequest from @rippledb/server', () => {
      const change: Change<TestSchema> = makeUpsert<TestSchema>({
        stream: 'test',
        entity: 'todo',
        entityId: '1',
        patch: { id: '1', title: 'Hello', done: false },
        hlc: makeHlc('node1', 1000),
      });

      const req: AppendRequest<TestSchema> = {
        stream: 'test',
        changes: [change],
        idempotencyKey: 'key123',
      };

      const result = appendRequestSchema.safeParse(req);
      expect(result.success).toBe(true);
    });
  });

  describe('appendResultSchema', () => {
    it('validates AppendResult from @rippledb/server', () => {
      const res: AppendResult = {
        accepted: 5,
        hlc: makeHlc('server', 2000),
      };

      const result = appendResultSchema.safeParse(res);
      expect(result.success).toBe(true);
    });

    it('validates AppendResult without hlc', () => {
      const res: AppendResult = {
        accepted: 0,
      };

      const result = appendResultSchema.safeParse(res);
      expect(result.success).toBe(true);
    });
  });

  describe('withZod', () => {
    it('auto-generates Zod schemas from field descriptors', () => {
      const schema = defineSchema({
        todos: {
          id: s.string(),
          title: s.string(),
          done: s.boolean(),
        },
      });

      const schemaWithZod = withZod(schema);

      // Test that .zod exists with correct entity
      expect(schemaWithZod.zod.todos).toBeDefined();

      // Test parsing valid data
      const validTodo = { id: '1', title: 'Test', done: false };
      const result = schemaWithZod.zod.todos.safeParse(validTodo);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validTodo);
      }
    });

    it('rejects invalid data', () => {
      const schema = defineSchema({
        todos: {
          id: s.string(),
          title: s.string(),
          done: s.boolean(),
        },
      });

      const schemaWithZod = withZod(schema);

      // Test parsing invalid data
      const invalidTodo = { id: 123, title: 'Test', done: 'not a boolean' };
      const result = schemaWithZod.zod.todos.safeParse(invalidTodo);
      expect(result.success).toBe(false);
    });

    it('supports number fields', () => {
      const schema = defineSchema({
        items: {
          id: s.string(),
          count: s.number(),
          price: s.number(),
        },
      });

      const schemaWithZod = withZod(schema);

      const validItem = { id: '1', count: 5, price: 9.99 };
      const result = schemaWithZod.zod.items.safeParse(validItem);
      expect(result.success).toBe(true);

      const invalidItem = { id: '1', count: 'five', price: 9.99 };
      const invalidResult = schemaWithZod.zod.items.safeParse(invalidItem);
      expect(invalidResult.success).toBe(false);
    });

    // Note: Type error tests for extra fields/entities are in index.test-d.ts
    // Vitest runs .test-d.ts files through tsc and will fail tests if type errors
    // occur unexpectedly or if @ts-expect-error directives are unused.

    it('supports enum fields', () => {
      const schema = defineSchema({
        tasks: {
          id: s.string(),
          status: s.enum(['pending', 'active', 'done'] as const),
        },
      });

      const schemaWithZod = withZod(schema);

      const validTask = { id: '1', status: 'active' };
      const result = schemaWithZod.zod.tasks.safeParse(validTask);
      expect(result.success).toBe(true);

      const invalidTask = { id: '1', status: 'invalid' };
      const invalidResult = schemaWithZod.zod.tasks.safeParse(invalidTask);
      expect(invalidResult.success).toBe(false);
    });

    it('supports optional fields', () => {
      const schema = defineSchema({
        todos: {
          id: s.string(),
          title: s.string(),
          notes: s.string().optional(),
        },
      });

      const schemaWithZod = withZod(schema);

      // With optional field present
      const withNotes = { id: '1', title: 'Test', notes: 'Some notes' };
      expect(schemaWithZod.zod.todos.safeParse(withNotes).success).toBe(true);

      // Without optional field
      const withoutNotes = { id: '1', title: 'Test' };
      expect(schemaWithZod.zod.todos.safeParse(withoutNotes).success).toBe(true);

      // With optional field as undefined
      const withUndefined = { id: '1', title: 'Test', notes: undefined };
      expect(schemaWithZod.zod.todos.safeParse(withUndefined).success).toBe(true);
    });

    it('supports overrides for specific fields', () => {
      const schema = defineSchema({
        users: {
          id: s.string(),
          email: s.string(),
          age: s.number(),
        },
      });

      const schemaWithZod = withZod(schema, {
        users: {
          email: z.string().email(),
          age: z.number().int().min(0).max(150),
        },
      });

      // Valid email and age
      const validUser = { id: '1', email: 'test@example.com', age: 25 };
      expect(schemaWithZod.zod.users.safeParse(validUser).success).toBe(true);

      // Invalid email
      const invalidEmail = { id: '1', email: 'not-an-email', age: 25 };
      expect(schemaWithZod.zod.users.safeParse(invalidEmail).success).toBe(false);

      // Invalid age (negative)
      const invalidAge = { id: '1', email: 'test@example.com', age: -5 };
      expect(schemaWithZod.zod.users.safeParse(invalidAge).success).toBe(false);

      // Invalid age (too high)
      const tooOld = { id: '1', email: 'test@example.com', age: 200 };
      expect(schemaWithZod.zod.users.safeParse(tooOld).success).toBe(false);
    });

    it('preserves schema descriptor properties', () => {
      const schema = defineSchema({
        todos: {
          id: s.string(),
          title: s.string(),
        },
        users: {
          id: s.string(),
          name: s.string(),
        },
      });

      const schemaWithZod = withZod(schema);

      // Original properties still work
      expect(schemaWithZod.entities).toEqual(['todos', 'users']);
      expect(schemaWithZod.getFields('todos')).toEqual(['id', 'title']);
      expect(schemaWithZod.hasField('users', 'name')).toBe(true);
      expect(schemaWithZod.hasField('users', 'email')).toBe(false);
    });

    it('stores zod schemas in extensions', () => {
      const schema = defineSchema({
        todos: {
          id: s.string(),
          title: s.string(),
        },
      });

      const schemaWithZod = withZod(schema);

      // Zod schemas are stored in extensions
      expect(schemaWithZod.extensions.has('zod')).toBe(true);
    });
  });

  describe('generateZodSchemas', () => {
    it('generates Zod schemas without wrapping descriptor', () => {
      const schema = defineSchema({
        todos: {
          id: s.string(),
          title: s.string(),
          done: s.boolean(),
        },
      });

      const zodSchemas = generateZodSchemas(schema);

      expect(zodSchemas.todos).toBeDefined();

      const validTodo = { id: '1', title: 'Test', done: false };
      const result = zodSchemas.todos.safeParse(validTodo);
      expect(result.success).toBe(true);
    });

    it('supports overrides', () => {
      const schema = defineSchema({
        users: {
          id: s.string(),
          email: s.string(),
        },
      });

      const zodSchemas = generateZodSchemas(schema, {
        users: {
          email: z.string().email(),
        },
      });

      const validUser = { id: '1', email: 'test@example.com' };
      expect(zodSchemas.users.safeParse(validUser).success).toBe(true);

      const invalidUser = { id: '1', email: 'not-an-email' };
      expect(zodSchemas.users.safeParse(invalidUser).success).toBe(false);
    });
  });
});
