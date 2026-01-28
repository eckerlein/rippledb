import type { RippleSchema, EntityName } from './change';

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
 * - Metadata attachment (Zod schemas, Drizzle tables, field maps, etc.)
 * - Type inference (still driven by TS generics, but descriptor is typed)
 * 
 * @example
 * ```ts
 * const schema = defineSchema({
 *   todos: { id: '', title: '', done: false },
 *   users: { id: '', name: '', email: '' },
 * });
 * 
 * // Runtime entity discovery
 * schema.entities; // ['todos', 'users']
 * 
 * // Runtime property discovery
 * schema.getFields('todos'); // ['id', 'title', 'done']
 * 
 * // Type-safe access
 * type MySchema = typeof schema.schema;
 * ```
 */
export type SchemaDescriptor<
  S extends RippleSchema = RippleSchema,
> = {
  /**
   * The original schema object (for type inference and runtime introspection).
   */
  readonly schema: S;
  
  /**
   * Array of entity names for runtime discovery.
   */
  readonly entities: readonly EntityName<S>[];
  
  /**
   * Map of entity names to entity names (for O(1) lookup).
   */
  readonly entityMap: ReadonlyMap<EntityName<S>, true>;
  
  /**
   * Map of entity names to their field names.
   */
  readonly entityFields: ReadonlyMap<EntityName<S>, readonly string[]>;
  
  /**
   * Get field names for a specific entity.
   * 
   * @param entity - The entity name
   * @returns Array of field names, or empty array if entity not found
   */
  getFields<E extends EntityName<S>>(entity: E): readonly string[];
  
  /**
   * Check if an entity has a specific field.
   * 
   * @param entity - The entity name
   * @param field - The field name
   * @returns True if the entity has the field
   */
  hasField<E extends EntityName<S>>(entity: E, field: string): boolean;
  
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
 * Creates a runtime schema descriptor from entity definitions.
 * 
 * The descriptor provides runtime entity and property discovery while maintaining
 * full TypeScript type safety through generics.
 * 
 * @param entities - Object where keys are entity names and values are sample objects
 *                   with all properties (values are used to infer field names at runtime)
 * @returns A typed schema descriptor with runtime entity and property discovery
 * 
 * @example
 * ```ts
 * const schema = defineSchema({
 *   todos: { id: '', title: '', done: false },
 *   users: { id: '', name: '', email: '' },
 * });
 * 
 * // Runtime entity discovery
 * for (const entity of schema.entities) {
 *   console.log(entity); // 'todos', 'users'
 * }
 * 
 * // Runtime property discovery
 * schema.getFields('todos'); // ['id', 'title', 'done']
 * schema.hasField('todos', 'title'); // true
 * 
 * // Type inference still works
 * type MySchema = typeof schema.schema;
 * const db = new SqliteDb<MySchema>({ ... });
 * ```
 */
export function defineSchema<S extends RippleSchema>(
  entities: S,
): SchemaDescriptor<S> {
  const entityNames = Object.keys(entities) as EntityName<S>[];
  const entityMap = new Map<EntityName<S>, true>();
  const entityFields = new Map<EntityName<S>, readonly string[]>();
  
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
    entities: Object.freeze(entityNames) as readonly EntityName<S>[],
    entityMap: Object.freeze(entityMap) as ReadonlyMap<EntityName<S>, true>,
    entityFields: Object.freeze(entityFields) as ReadonlyMap<EntityName<S>, readonly string[]>,
    
    getFields<E extends EntityName<S>>(entity: E): readonly string[] {
      return entityFields.get(entity) ?? [];
    },
    
    hasField<E extends EntityName<S>>(entity: E, field: string): boolean {
      const fields = entityFields.get(entity) ?? [];
      return fields.includes(field);
    },
    
    extensions: Object.freeze(extensions) as ReadonlyMap<string, SchemaExtension>,
    
    extend<K extends string, E extends SchemaExtension>(
      key: K,
      extension: E,
    ): SchemaDescriptor<S> {
      const newExtensions = new Map(this.extensions);
      newExtensions.set(key, extension);
      
      return {
        ...this,
        extensions: Object.freeze(newExtensions) as ReadonlyMap<string, SchemaExtension>,
      };
    },
  };
}
