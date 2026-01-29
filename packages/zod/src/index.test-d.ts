import { defineSchema, s } from '@rippledb/core';
import { withZod, generateZodSchemas } from './index';
import { z } from 'zod';
import { test } from 'vitest';

/**
 * Type tests for ZodOverrides
 * 
 * These tests verify that TypeScript correctly catches type errors when:
 * 1. Extra fields that don't exist in the schema are provided
 * 2. Extra entities that don't exist in the schema are provided
 * 
 * Vitest will run these through tsc and fail the test if:
 * - A type error occurs without @ts-expect-error
 * - @ts-expect-error is used but no error occurs (unused directive)
 */

test('valid overrides work correctly (no type errors)', () => {
  const schema = defineSchema({
    items: {
      id: s.string(),
      count: s.number(),
      price: s.number(),
    },
  });

  // These should NOT cause type errors
  withZod(schema, {
    items: {
      count: z.number().int().min(0).max(100),
      price: z.number().min(0).max(1000),
    },
  });

  generateZodSchemas(schema, {
    items: {
      count: z.number().int().min(0).max(100),
      price: z.number().min(0).max(1000),
    },
  });
});


test('extra fields in overrides cause type errors', () => {
  const schema = defineSchema({
    items: {
      id: s.string(),
      count: s.number(),
      price: s.number(),
    },
  });

  // This SHOULD cause a type error because 'name' is not in the schema
  // @ts-expect-error - 'name' does not exist in schema
  withZod(schema, {
    items: {
      count: z.number().int().min(0).max(100),
      price: z.number().min(0).max(1000),
      name: z.string().min(1).max(100), // Extra field not in schema
    },
  });

  // This SHOULD also cause a type error
  // @ts-expect-error - 'name' does not exist in schema
  generateZodSchemas(schema, {
    items: {
      count: z.number().int().min(0).max(100),
      price: z.number().min(0).max(1000),
      name: z.string().min(1).max(100), // Extra field not in schema
    },
  });
});

test('extra fields in overrides cause type errors when passed in not directly in withZod', () => {
  const schema = defineSchema({
    items: {
      id: s.string(),
      count: s.number(),
    },
  });
  
  const overrides = {
    items: {
      count: z.number().int(),
      name: z.string().min(1).max(100),
    },
  } as const;

  // @ts-expect-error - 'name' does not exist in schema
  withZod(schema, overrides);
});

test('extra entities in overrides cause type errors', () => {
  const schema = defineSchema({
    items: {
      id: s.string(),
      count: s.number(),
    },
  });

  // This SHOULD cause a type error because 'users' is not in the schema
  // @ts-expect-error - 'users' entity does not exist in schema
  withZod(schema, {
    items: {
      count: z.number().int(),
    },
    users: {
      name: z.string(),
    },
  });
});


test('extra entities in overrides cause type errors when passed in not directly in withZod', () => {
  const schema = defineSchema({
    items: {
      id: s.string(),
      count: s.number(),
    },
  });
  
  const overrides = {
    items: {
      count: z.number().int(),
    },
    users: {
      name: z.string().min(1).max(100),
    },
  };

  // @ts-expect-error - 'users' entity does not exist in schema
  withZod(schema, overrides);
});