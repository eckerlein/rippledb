import type {
  DescriptorSchema,
  FieldDescriptorLike,
  SchemaDescriptor,
} from "@rippledb/core";
import { z } from "zod";

// ============================================================================
// withZod - Auto-generate Zod schemas from field descriptors
// ============================================================================

/**
 * Helper type to validate that overrides only contain valid entities and fields.
 * When used with `as const`, this helps catch extra properties even when assigned to variables.
 */
type ValidateOverrides<S extends DescriptorSchema, O> =
  // Special case: empty overrides object is always valid
  [keyof O] extends [never]
    ? O
    : // Check that all entity keys in O are valid entities in S
      keyof O extends keyof S
      ? // For each entity, check that all field keys are valid
        {
          [E in keyof O]: E extends keyof S
            ? keyof O[E] extends keyof S[E]
              ? unknown // Valid
              : never // Invalid - has extra fields
            : never; // Invalid - entity doesn't exist
        }[keyof O] extends never
        ? never // At least one entity has invalid fields
        : O // All valid
      : never; // Has extra entities

/**
 * Typed overrides for Zod schemas - constrained to valid entities and fields.
 */
export type ZodOverrides<S extends DescriptorSchema> = {
  [E in keyof S]?: {
    [F in keyof S[E]]?: z.ZodTypeAny;
  };
};

/**
 * Generated Zod schemas for each entity.
 */
export type ZodSchemas<S extends DescriptorSchema> = {
  [E in keyof S]: z.ZodObject<{
    [F in keyof S[E]]: z.ZodTypeAny;
  }>;
};

/**
 * Schema descriptor with typed Zod schema access.
 */
export type SchemaDescriptorWithZod<S extends DescriptorSchema> =
  SchemaDescriptor<S> & {
    /**
     * Auto-generated Zod schemas for each entity.
     * Access via `schema.zod.entityName.parse(data)`.
     */
    readonly zod: ZodSchemas<S>;
  };

/**
 * Converts a field descriptor to a Zod schema.
 */
function fieldDescriptorToZod(field: FieldDescriptorLike): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (field._type) {
    case "string":
      schema = z.string();
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "enum": {
      // Cast to access the values property on enum fields
      const enumField = field as unknown as { values: readonly string[] };
      if (!enumField.values || enumField.values.length === 0) {
        schema = z.never();
      } else if (enumField.values.length === 1) {
        schema = z.literal(enumField.values[0]);
      } else {
        schema = z.enum(enumField.values as [string, ...string[]]);
      }
      break;
    }
    default:
      schema = z.unknown();
  }

  if (field._optional) {
    schema = schema.optional();
  }

  return schema;
}

/**
 * Wraps a SchemaDescriptor with auto-generated Zod schemas.
 *
 * The Zod schemas are generated from the field descriptors in the schema.
 * You can optionally provide overrides to customize individual field schemas
 * (e.g., to add refinements like `.min()`, `.max()`, `.email()`, etc.).
 *
 * @param schema - The schema descriptor to wrap
 * @param overrides - Optional Zod schema overrides for specific fields
 * @returns A schema descriptor with typed `.zod` access
 *
 * @example
 * ```ts
 * import { defineSchema, s } from '@rippledb/core';
 * import { withZod } from '@rippledb/zod';
 * import { z } from 'zod';
 *
 * const schema = defineSchema({
 *   todos: {
 *     id: s.string(),
 *     title: s.string(),
 *     done: s.boolean(),
 *   },
 *   users: {
 *     id: s.string(),
 *     name: s.string(),
 *     email: s.string(),
 *   },
 * });
 *
 * // Basic usage - auto-generate all Zod schemas
 * const schemaWithZod = withZod(schema);
 *
 * // Validate data
 * const todo = schemaWithZod.zod.todos.parse({ id: '1', title: 'Test', done: false });
 *
 * // With overrides - add refinements
 * const schemaWithRefinements = withZod(schema, {
 *   todos: {
 *     title: z.string().min(1).max(100),
 *   },
 *   users: {
 *     email: z.string().email(),
 *   },
 * });
 * ```
 */
export function withZod<S extends DescriptorSchema, O extends ZodOverrides<S>>(
  schema: SchemaDescriptor<S>,
  overrides?: O & ValidateOverrides<S, O>,
): SchemaDescriptorWithZod<S> {
  const zodSchemas = {} as Record<
    string,
    z.ZodObject<Record<string, z.ZodTypeAny>>
  >;

  for (const entityName of schema.entities) {
    const entityDescriptor = schema.schema[entityName];
    const entityOverridesObj = overrides?.[entityName as keyof S] as
      | Record<string, z.ZodTypeAny>
      | undefined;
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const fieldName of Object.keys(entityDescriptor)) {
      const fieldDescriptor = entityDescriptor[fieldName];
      // Use override if provided, otherwise generate from descriptor
      shape[fieldName] =
        entityOverridesObj?.[fieldName] ??
        fieldDescriptorToZod(fieldDescriptor);
    }

    zodSchemas[entityName] = z.object(shape);
  }

  // Extend the schema with the zod extension
  const extendedSchema = schema.extend("zod", zodSchemas);

  return {
    ...extendedSchema,
    zod: zodSchemas as ZodSchemas<S>,
  };
}

/**
 * Generates Zod schemas from a schema descriptor without wrapping it.
 * Use this if you only need the Zod schemas without the extended descriptor.
 *
 * @param schema - The schema descriptor
 * @param overrides - Optional Zod schema overrides
 * @returns Generated Zod schemas for each entity
 */
export function generateZodSchemas<
  S extends DescriptorSchema,
  O extends ZodOverrides<S>,
>(
  schema: SchemaDescriptor<S>,
  overrides?: O & ValidateOverrides<S, O>,
): ZodSchemas<S> {
  const zodSchemas = {} as Record<
    string,
    z.ZodObject<Record<string, z.ZodTypeAny>>
  >;

  for (const entityName of schema.entities) {
    const entityDescriptor = schema.schema[entityName];
    const entityOverridesObj = overrides?.[entityName as keyof S] as
      | Record<string, z.ZodTypeAny>
      | undefined;
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const fieldName of Object.keys(entityDescriptor)) {
      const fieldDescriptor = entityDescriptor[fieldName];
      shape[fieldName] =
        entityOverridesObj?.[fieldName] ??
        fieldDescriptorToZod(fieldDescriptor);
    }

    zodSchemas[entityName] = z.object(shape);
  }

  return zodSchemas as ZodSchemas<S>;
}

// ============================================================================
// Existing schemas for RippleDB protocol types
// ============================================================================

/**
 * Zod schema for HLC (Hybrid Logical Clock) timestamps.
 * Format: "{wallTimeMs}:{counter}:{nodeId}"
 */
export const hlcSchema = z.string().regex(/^\d+:\d+:.+$/, "Invalid HLC format");

/**
 * Zod schema for change kind (upsert or delete).
 */
export const changeKindSchema = z.enum(["upsert", "delete"]);

/**
 * Creates a Zod schema for a Change object.
 *
 * @example
 * ```ts
 * const todoChangeSchema = createChangeSchema(z.object({
 *   id: z.string(),
 *   title: z.string(),
 *   done: z.boolean().optional(),
 * }));
 * ```
 */
export function createChangeSchema<T extends z.ZodObject<z.ZodRawShape>>(
  patchSchema: T,
) {
  return z.object({
    stream: z.string(),
    entity: z.string(),
    entityId: z.string(),
    kind: changeKindSchema,
    patch: patchSchema.partial(),
    tags: z.record(z.string(), hlcSchema),
    hlc: hlcSchema,
  });
}

/**
 * Generic change schema when patch structure is unknown.
 */
export const changeSchema = z.object({
  stream: z.string(),
  entity: z.string(),
  entityId: z.string(),
  kind: changeKindSchema,
  patch: z.record(z.string(), z.unknown()),
  tags: z.record(z.string(), hlcSchema),
  hlc: hlcSchema,
});

/**
 * Zod schema for PullRequest.
 */
export const pullRequestSchema = z.object({
  stream: z.string(),
  cursor: z.string().nullable(),
  limit: z.number().int().positive().optional(),
});

/**
 * Creates a Zod schema for PullResponse with typed changes.
 */
export function createPullResponseSchema<T extends z.ZodTypeAny>(
  changeSchema: T,
) {
  return z.object({
    changes: z.array(changeSchema),
    nextCursor: z.string().nullable(),
  });
}

/**
 * Generic pull response schema.
 */
export const pullResponseSchema = createPullResponseSchema(changeSchema);

/**
 * Creates a Zod schema for AppendRequest with typed changes.
 */
export function createAppendRequestSchema<T extends z.ZodTypeAny>(
  changeSchema: T,
) {
  return z.object({
    stream: z.string(),
    idempotencyKey: z.string().optional(),
    changes: z.array(changeSchema),
  });
}

/**
 * Generic append request schema.
 */
export const appendRequestSchema = createAppendRequestSchema(changeSchema);

/**
 * Zod schema for AppendResult.
 */
export const appendResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
  hlc: hlcSchema.optional(),
});

// Re-export zod types for convenience
export type HlcInput = z.infer<typeof hlcSchema>;
export type ChangeKindInput = z.infer<typeof changeKindSchema>;
export type ChangeInput = z.infer<typeof changeSchema>;
export type PullRequestInput = z.infer<typeof pullRequestSchema>;
export type PullResponseInput = z.infer<typeof pullResponseSchema>;
export type AppendRequestInput = z.infer<typeof appendRequestSchema>;
export type AppendResultInput = z.infer<typeof appendResultSchema>;
