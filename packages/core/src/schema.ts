// ============================================================================
// Field Descriptor Types
// ============================================================================

/**
 * String field descriptor.
 */
export type StringField<Optional extends boolean = false> = {
  readonly _type: "string";
  readonly _optional: Optional;
};

/**
 * Number field descriptor.
 */
export type NumberField<Optional extends boolean = false> = {
  readonly _type: "number";
  readonly _optional: Optional;
};

/**
 * Boolean field descriptor.
 */
export type BooleanField<Optional extends boolean = false> = {
  readonly _type: "boolean";
  readonly _optional: Optional;
};

/**
 * Enum field descriptor with literal union type.
 */
export type EnumField<
  T extends readonly string[] = readonly string[],
  Optional extends boolean = false,
> = {
  readonly _type: "enum";
  readonly values: T;
  readonly _optional: Optional;
};

/**
 * Union of all field descriptor types.
 */
export type FieldDescriptor =
  | StringField<boolean>
  | NumberField<boolean>
  | BooleanField<boolean>
  | EnumField<readonly string[], boolean>;

/**
 * Base field descriptor shape for type checking.
 * This is used as the constraint for DescriptorSchema to accept both
 * field descriptors and field builders (which include the optional() method).
 */
export type FieldDescriptorLike = {
  readonly _type: string;
  readonly _optional: boolean;
};

/**
 * Schema definition using field descriptors.
 * Each entity maps to an object of field descriptors or builders.
 */
export type DescriptorSchema = Record<
  string,
  Record<string, FieldDescriptorLike>
>;

// ============================================================================
// Field Descriptor Builders
// ============================================================================

/**
 * Field builder interface with optional() method.
 */
interface StringFieldBuilder {
  readonly _type: "string";
  readonly _optional: false;
  optional(): StringField<true>;
}

interface NumberFieldBuilder {
  readonly _type: "number";
  readonly _optional: false;
  optional(): NumberField<true>;
}

interface BooleanFieldBuilder {
  readonly _type: "boolean";
  readonly _optional: false;
  optional(): BooleanField<true>;
}

interface EnumFieldBuilder<T extends readonly string[]> {
  readonly _type: "enum";
  readonly values: T;
  readonly _optional: false;
  optional(): EnumField<T, true>;
}

/**
 * Schema field descriptor builders.
 *
 * Use these to define your schema with proper type inference:
 *
 * @example
 * ```ts
 * import { defineSchema, s } from '@rippledb/core';
 *
 * const schema = defineSchema({
 *   todos: {
 *     id: s.string(),
 *     title: s.string(),
 *     done: s.boolean(),
 *     status: s.enum(['pending', 'active', 'done']),
 *     notes: s.string().optional(),
 *   },
 * });
 *
 * type MySchema = InferSchema<typeof schema>;
 * ```
 */
export const s = {
  /**
   * Creates a string field descriptor.
   */
  string(): StringFieldBuilder {
    return {
      _type: "string" as const,
      _optional: false as const,
      optional() {
        return { _type: "string" as const, _optional: true as const };
      },
    };
  },

  /**
   * Creates a number field descriptor.
   */
  number(): NumberFieldBuilder {
    return {
      _type: "number" as const,
      _optional: false as const,
      optional() {
        return { _type: "number" as const, _optional: true as const };
      },
    };
  },

  /**
   * Creates a boolean field descriptor.
   */
  boolean(): BooleanFieldBuilder {
    return {
      _type: "boolean" as const,
      _optional: false as const,
      optional() {
        return { _type: "boolean" as const, _optional: true as const };
      },
    };
  },

  /**
   * Creates an enum field descriptor with literal type inference.
   *
   * @param values - Array of allowed string values
   *
   * @example
   * ```ts
   * s.enum(['pending', 'active', 'done'])
   * // Infers as: 'pending' | 'active' | 'done'
   * ```
   */
  enum<T extends readonly string[]>(values: T): EnumFieldBuilder<T> {
    return {
      _type: "enum" as const,
      values,
      _optional: false as const,
      optional() {
        return { _type: "enum" as const, values, _optional: true as const };
      },
    };
  },
} as const;

// ============================================================================
// Type Inference Helpers
// ============================================================================

/**
 * Infers the TypeScript type from a field descriptor.
 */
export type InferField<F> = F extends { _type: "string"; _optional: true; }
  ? string | undefined
  : F extends { _type: "string"; } ? string
  : F extends { _type: "number"; _optional: true; } ? number | undefined
  : F extends { _type: "number"; } ? number
  : F extends { _type: "boolean"; _optional: true; } ? boolean | undefined
  : F extends { _type: "boolean"; } ? boolean
  : F extends { _type: "enum"; values: infer V; _optional: true; }
    ? V extends readonly string[] ? V[number] | undefined
    : never
  : F extends { _type: "enum"; values: infer V; }
    ? V extends readonly string[] ? V[number]
    : never
  : never;

/**
 * Infers the TypeScript type for an entity from its field descriptors.
 */
export type InferEntity<E extends Record<string, FieldDescriptorLike>> = {
  [K in keyof E]: InferField<E[K]>;
};

/**
 * Infers the full RippleSchema type from a SchemaDescriptor.
 *
 * @example
 * ```ts
 * const schema = defineSchema({
 *   todos: {
 *     id: s.string(),
 *     title: s.string(),
 *     done: s.boolean(),
 *     status: s.enum(['pending', 'active', 'done']),
 *   },
 * });
 *
 * type MySchema = InferSchema<typeof schema>;
 * // = {
 * //   todos: {
 * //     id: string;
 * //     title: string;
 * //     done: boolean;
 * //     status: 'pending' | 'active' | 'done';
 * //   }
 * // }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InferSchema<D extends SchemaDescriptor<any>> = {
  [E in keyof D["schema"]]: InferEntity<D["schema"][E]>;
};

// ============================================================================
// Schema Descriptor
// ============================================================================

/**
 * Extension metadata that can be attached to schema descriptors.
 * Extensions are keyed by extension name and can contain arbitrary data.
 */
export type SchemaExtension = Record<string, unknown>;

/**
 * Runtime schema descriptor that provides entity discovery and extensible metadata.
 *
 * This is the canonical hub for:
 * - Entity discovery (runtime list of entities)
 * - Property/field discovery (runtime list of fields per entity)
 * - Field type metadata (runtime access to field types)
 * - Metadata attachment (Zod schemas, Drizzle tables, field maps, etc.)
 * - Type inference (via InferSchema helper)
 *
 * @example
 * ```ts
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
 * // Runtime entity discovery
 * schema.entities; // ['todos', 'users']
 *
 * // Runtime property discovery
 * schema.getFields('todos'); // ['id', 'title', 'done']
 *
 * // Runtime field type access
 * schema.getFieldDescriptor('todos', 'done'); // { _type: 'boolean' }
 *
 * // Type inference
 * type MySchema = InferSchema<typeof schema>;
 * ```
 */
export type SchemaDescriptor<S extends DescriptorSchema = DescriptorSchema> = {
  /**
   * The original schema object with field descriptors.
   */
  readonly schema: S;

  /**
   * Array of entity names for runtime discovery.
   */
  readonly entities: readonly (keyof S & string)[];

  /**
   * Map of entity names to entity names (for O(1) lookup).
   */
  readonly entityMap: ReadonlyMap<keyof S & string, true>;

  /**
   * Map of entity names to their field names.
   */
  readonly entityFields: ReadonlyMap<keyof S & string, readonly string[]>;

  /**
   * Get field names for a specific entity.
   *
   * @param entity - The entity name
   * @returns Array of field names, or empty array if entity not found
   */
  getFields<E extends keyof S & string>(
    entity: E,
  ): readonly (keyof S[E] & string)[];

  /**
   * Check if an entity has a specific field.
   *
   * @param entity - The entity name
   * @param field - The field name
   * @returns True if the entity has the field
   */
  hasField<E extends keyof S & string>(entity: E, field: string): boolean;

  /**
   * Get the field descriptor for a specific field.
   *
   * @param entity - The entity name
   * @param field - The field name
   * @returns The field descriptor, or undefined if not found
   */
  getFieldDescriptor<E extends keyof S & string, F extends keyof S[E] & string>(
    entity: E,
    field: F,
  ): S[E][F] | undefined;

  /**
   * Extensible metadata attached to this schema descriptor.
   * Extensions can be added by adapters (Zod, Drizzle, etc.).
   */
  readonly extensions: ReadonlyMap<string, SchemaExtension>;

  /**
   * Attach metadata to this schema descriptor.
   * Returns a new descriptor with the extension added.
   *
   * @example
   * ```ts
   * const schemaWithZod = schema.extend('zod', {
   *   todos: z.object({ id: z.string(), title: z.string() }),
   * });
   * ```
   */
  extend<K extends string, E extends SchemaExtension>(
    key: K,
    extension: E,
  ): SchemaDescriptor<S>;
};

/**
 * Creates a runtime schema descriptor from field descriptors.
 *
 * The descriptor provides runtime entity and property discovery while maintaining
 * full TypeScript type safety through the `InferSchema` helper.
 *
 * @param entities - Object where keys are entity names and values are objects
 *                   with field descriptors created using `s.string()`, `s.boolean()`, etc.
 * @returns A typed schema descriptor with runtime entity and property discovery
 *
 * @example
 * ```ts
 * import { defineSchema, s, InferSchema } from '@rippledb/core';
 *
 * const schema = defineSchema({
 *   todos: {
 *     id: s.string(),
 *     title: s.string(),
 *     done: s.boolean(),
 *     status: s.enum(['pending', 'active', 'done']),
 *   },
 *   users: {
 *     id: s.string(),
 *     name: s.string(),
 *     email: s.string(),
 *   },
 * });
 *
 * // Infer the data type for use with Store, Change, etc.
 * type MySchema = InferSchema<typeof schema>;
 *
 * // Runtime entity discovery
 * for (const entity of schema.entities) {
 *   console.log(entity); // 'todos', 'users'
 * }
 *
 * // Runtime property discovery
 * schema.getFields('todos'); // ['id', 'title', 'done', 'status']
 * schema.hasField('todos', 'title'); // true
 *
 * // Use the inferred type with other RippleDB APIs
 * const store = new MemoryStore<MySchema>();
 * ```
 */
export function defineSchema<S extends DescriptorSchema>(
  entities: S,
): SchemaDescriptor<S> {
  const entityNames = Object.keys(entities) as (keyof S & string)[];
  const entityMap = new Map<keyof S & string, true>();
  const entityFields = new Map<keyof S & string, readonly string[]>();

  for (const name of entityNames) {
    entityMap.set(name, true);

    // Extract field names from the entity object
    const entityValue = entities[name];
    const fields = Object.keys(entityValue) as readonly string[];
    entityFields.set(name, Object.freeze(fields));
  }

  const extensions = new Map<string, SchemaExtension>();

  return {
    schema: entities,
    entities: Object.freeze(entityNames) as readonly (keyof S & string)[],
    entityMap: Object.freeze(entityMap) as ReadonlyMap<keyof S & string, true>,
    entityFields: Object.freeze(entityFields) as ReadonlyMap<
      keyof S & string,
      readonly string[]
    >,

    getFields<E extends keyof S & string>(
      entity: E,
    ): readonly (keyof S[E] & string)[] {
      return (entityFields.get(entity) ?? []) as readonly (
        & keyof S[E]
        & string
      )[];
    },

    hasField<E extends keyof S & string>(entity: E, field: string): boolean {
      const fields = entityFields.get(entity) ?? [];
      return fields.includes(field);
    },

    getFieldDescriptor<
      E extends keyof S & string,
      F extends keyof S[E] & string,
    >(entity: E, field: F): S[E][F] | undefined {
      const entityDef = entities[entity];
      if (!entityDef) return undefined;
      return entityDef[field];
    },

    extensions: Object.freeze(extensions) as ReadonlyMap<
      string,
      SchemaExtension
    >,

    extend<K extends string, Ext extends SchemaExtension>(
      key: K,
      extension: Ext,
    ): SchemaDescriptor<S> {
      const newExtensions = new Map(this.extensions);
      newExtensions.set(key, extension);

      return {
        ...this,
        extensions: Object.freeze(newExtensions) as ReadonlyMap<
          string,
          SchemaExtension
        >,
      };
    },
  };
}
