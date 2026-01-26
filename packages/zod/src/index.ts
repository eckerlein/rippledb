import { z } from 'zod';

/**
 * Zod schema for HLC (Hybrid Logical Clock) timestamps.
 * Format: "{wallTimeMs}:{counter}:{nodeId}"
 */
export const hlcSchema = z.string().regex(/^\d+:\d+:.+$/, 'Invalid HLC format');

/**
 * Zod schema for change kind (upsert or delete).
 */
export const changeKindSchema = z.enum(['upsert', 'delete']);

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
export function createChangeSchema<T extends z.ZodObject<z.ZodRawShape>>(patchSchema: T) {
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
export function createPullResponseSchema<T extends z.ZodTypeAny>(changeSchema: T) {
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
export function createAppendRequestSchema<T extends z.ZodTypeAny>(changeSchema: T) {
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
