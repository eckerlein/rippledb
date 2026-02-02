import {
  type ListRegistry,
  wireTanstackInvalidation,
} from "@rippledb/bind-tanstack-query";
import type { Store } from "@rippledb/client";
import {
  createEntityController,
  type EntityController,
} from "@rippledb/client-controllers";
import type {
  DescriptorSchema,
  EntityName,
  InferSchema,
  RippleSchema,
  SchemaDescriptor,
} from "@rippledb/core";
import type { QueryClient } from "@tanstack/query-core";

/**
 * Query helper options for registering list queries with automatic invalidation.
 */
export type QueryOptions<S extends RippleSchema = RippleSchema, T = unknown> = {
  /**
   * The query key prefix to invalidate (e.g. ['todos'], ['todoList']).
   */
  key: readonly unknown[];
  /**
   * Entity names this query depends on.
   * When a DbEvent for any of these entities fires, the query is invalidated.
   */
  deps: readonly EntityName<S>[];
  /**
   * The query function to execute.
   */
  fn: () => Promise<T>;
};

/**
 * Client Query API that combines controllers with TanStack Query invalidation.
 *
 * Provides:
 * - Dynamic entity controllers (api.todos, api.users, etc.)
 * - Automatic cache invalidation
 * - Query helpers with dependency tracking
 *
 * @example
 * ```ts
 * const api = createClientQueryApi({
 *   store,
 *   stream: 'user-123',
 *   queryClient,
 *   schema: schemaDescriptor,
 * });
 *
 * // CRUD operations
 * const todo = await api.todos.create({ title: 'Buy milk' });
 * const fetched = await api.todos.read('todo-1');
 *
 * // Query helpers with automatic invalidation
 * const todos = await api.query({
 *   key: ['todos'],
 *   deps: ['todos'],
 *   fn: () => api.todos.list({ entity: 'todos' }),
 * });
 * ```
 */
export type ClientQueryApi<
  S extends RippleSchema = RippleSchema,
  ListQuery = unknown,
> = {
  /**
   * Entity controllers, dynamically created from schema.entities.
   * Each entity gets a controller with CRUD operations.
   */
  [K in EntityName<S>]: EntityController<S, K, ListQuery>;
} & {
  /**
   * Query helper that registers a query with automatic invalidation.
   *
   * @param options - Query options with key, deps, and fn
   * @returns The result of the query function
   */
  query<T>(options: QueryOptions<S, T>): Promise<T>;

  /**
   * Cleanup function to unsubscribe from invalidation events.
   */
  cleanup(): void;
};

export type CreateClientQueryApiOptions<
  D extends DescriptorSchema = DescriptorSchema,
  ListQuery = unknown,
> = {
  /**
   * The Store instance to operate on.
   * Must be typed with the inferred schema type.
   */
  store: Store<InferSchema<SchemaDescriptor<D>>, ListQuery>;

  /**
   * The stream ID for all changes created by controllers.
   */
  stream: string;

  /**
   * TanStack QueryClient instance.
   */
  queryClient: QueryClient;

  /**
   * Schema descriptor for runtime entity discovery.
   */
  schema: SchemaDescriptor<D>;

  /**
   * Optional list registry for custom query key mappings.
   * If not provided, a default registry is created from query() calls.
   */
  registry?: ListRegistry;

  /**
   * Debounce time in milliseconds for invalidation coalescing.
   * @default 50
   */
  debounceMs?: number;
};

/**
 * Creates a Client Query API that combines controllers with TanStack Query invalidation.
 *
 * The API dynamically creates entity controllers from the schema descriptor,
 * allowing you to use `api.todos`, `api.users`, etc. without manually creating
 * controllers for each entity.
 *
 * @example
 * ```ts
 * import { defineSchema, s, InferSchema } from '@rippledb/core';
 * import { createClientQueryApi } from '@rippledb/client-query';
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
 * type MySchema = InferSchema<typeof schema>;
 * const store = new MemoryStore<MySchema>();
 *
 * const api = createClientQueryApi({
 *   store,
 *   stream: 'user-123',
 *   queryClient,
 *   schema,
 * });
 *
 * // Use dynamic controllers
 * const todo = await api.todos.create({ title: 'Buy milk' });
 * const user = await api.users.read('user-1');
 * ```
 */
export function createClientQueryApi<
  D extends DescriptorSchema,
  ListQuery = unknown,
>(
  options: CreateClientQueryApiOptions<D, ListQuery>,
): ClientQueryApi<InferSchema<SchemaDescriptor<D>>, ListQuery> {
  type S = InferSchema<SchemaDescriptor<D>>;

  const {
    store,
    stream,
    queryClient,
    schema,
    registry: providedRegistry,
    debounceMs = 50,
  } = options;

  // Create controllers for each entity dynamically
  const controllers = {} as Record<
    EntityName<S>,
    EntityController<S, EntityName<S>, ListQuery>
  >;

  for (const entityName of schema.entities) {
    // Cast entity name to the correct type
    const entity = entityName as EntityName<S>;
    controllers[entity] = createEntityController({
      store,
      entity,
      stream,
    });
  }

  // If the caller doesn't provide a registry, we create a new mutable registry.
  // If a registry *is* provided, it is expected to be mutable and `api.query()`
  // will add entries to it dynamically (so invalidation works automatically).
  const registry: ListRegistry = providedRegistry ?? { entries: [] };

  // Wire up invalidation once
  const cleanup = wireTanstackInvalidation({
    queryClient,
    store,
    registry,
    debounceMs,
  });

  const registerQueryIfNeeded = (opts: QueryOptions<S, unknown>) => {
    // Avoid duplicate registrations for identical query keys (shallow compare)
    const exists = registry.entries.some((e) => {
      if (e.queryKey.length !== opts.key.length) return false;
      for (let i = 0; i < e.queryKey.length; i += 1) {
        if (!Object.is(e.queryKey[i], opts.key[i])) return false;
      }
      return true;
    });
    if (!exists) {
      registry.entries.push({
        queryKey: opts.key,
        deps: opts.deps as readonly string[],
      });
    }
  };

  // Create the API object with dynamic entity controllers
  const api = {
    ...controllers,

    async query<T>(queryOptions: QueryOptions<S, T>): Promise<T> {
      registerQueryIfNeeded(queryOptions);

      // Use TanStack Query for caching + consistent invalidation
      return await queryClient.fetchQuery({
        // TanStack queryKey expects readonly unknown[]; our key matches.
        queryKey: queryOptions.key,
        queryFn: async () => queryOptions.fn(),
      });
    },

    cleanup,
  } as ClientQueryApi<S, ListQuery>;

  return api;
}

// Re-export types for convenience
export type { ListRegistry } from "@rippledb/bind-tanstack-query";
export type { EntityController } from "@rippledb/client-controllers";
