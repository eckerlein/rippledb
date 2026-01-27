import type { RippleSchema, EntityName } from '@rippledb/core';
import type { DbEvent, Store } from '@rippledb/client';
import type { QueryClient } from '@tanstack/query-core';

// ============================================================================
// List Registry
// ============================================================================

export type ListRegistryEntry = {
  /**
   * The query key prefix to invalidate (e.g. ['todos'], ['todoList']).
   */
  queryKey: readonly unknown[];
  /**
   * Entity names this query depends on.
   * When a DbEvent for any of these entities fires, the query is invalidated.
   */
  deps: readonly string[];
};

export type ListRegistry = {
  entries: ListRegistryEntry[];
};

/**
 * Fluent builder for defining which query keys depend on which entities.
 *
 * @example
 * ```ts
 * const registry = defineListRegistry()
 *   .list(['todos'], { deps: ['todos'] })
 *   .list(['todoWithTags'], { deps: ['todos', 'tags'] })
 *   .list(['dashboard'], { deps: ['todos', 'users', 'projects'] });
 * ```
 */
export function defineListRegistry(): ListRegistryBuilder {
  return new ListRegistryBuilder([]);
}

class ListRegistryBuilder implements ListRegistry {
  constructor(public readonly entries: ListRegistryEntry[]) {}

  /**
   * Register a list query key and its entity dependencies.
   *
   * @param queryKey - The query key prefix to invalidate
   * @param opts - Configuration with `deps` array of entity names
   */
  list(
    queryKey: readonly unknown[],
    opts: { deps: readonly string[] },
  ): ListRegistryBuilder {
    return new ListRegistryBuilder([
      ...this.entries,
      { queryKey, deps: opts.deps },
    ]);
  }
}

// ============================================================================
// Invalidation Wiring
// ============================================================================

export type WireTanstackInvalidationOptions<
  S extends RippleSchema = RippleSchema,
> = {
  /**
   * TanStack QueryClient instance.
   */
  queryClient: QueryClient;

  /**
   * The store to listen to for DbEvents.
   * Must implement `onEvent(cb)`.
   */
  store?: Store<S>;

  /**
   * Alternative: provide onEvent callback directly (useful for testing).
   */
  onEvent?: (cb: (event: DbEvent<S>) => void) => () => void;

  /**
   * Registry mapping list query keys to their entity dependencies.
   */
  registry?: ListRegistry;

  /**
   * Debounce time in milliseconds to coalesce rapid-fire invalidations.
   * Set to 0 to disable debouncing.
   * @default 50
   */
  debounceMs?: number;

  /**
   * Whether to invalidate row queries ([entity, id]) directly.
   * @default true
   */
  invalidateRows?: boolean;
};

/**
 * Wire RippleDB DbEvents to TanStack Query cache invalidation.
 *
 * @example
 * ```ts
 * import { wireTanstackInvalidation, defineListRegistry } from '@rippledb/bind-tanstack';
 *
 * const registry = defineListRegistry()
 *   .list(['todos'], { deps: ['todos'] })
 *   .list(['dashboard'], { deps: ['todos', 'users'] });
 *
 * const cleanup = wireTanstackInvalidation({
 *   queryClient,
 *   store,
 *   registry,
 *   debounceMs: 50,
 * });
 *
 * // Later: cleanup() to unsubscribe
 * ```
 *
 * @returns Cleanup function to unsubscribe from events
 */
export function wireTanstackInvalidation<S extends RippleSchema = RippleSchema>(
  opts: WireTanstackInvalidationOptions<S>,
): () => void {
  const {
    queryClient,
    store,
    onEvent,
    registry,
    debounceMs = 50,
    invalidateRows = true,
  } = opts;

  // Get the event subscription function
  const subscribe = onEvent ?? store?.onEvent;
  if (!subscribe) {
    throw new Error(
      'wireTanstackInvalidation: either `store` (with onEvent) or `onEvent` callback is required',
    );
  }

  // Track pending invalidations for debouncing
  let pendingEntities = new Set<string>();
  let pendingRows: Array<{ entity: string; id: string }> = [];
  let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    debounceTimeout = null;

    // Invalidate row queries
    if (invalidateRows) {
      for (const { entity, id } of pendingRows) {
        queryClient.invalidateQueries({ queryKey: [entity, id] });
      }
    }

    // Invalidate list queries based on registry
    if (registry) {
      for (const entry of registry.entries) {
        const shouldInvalidate = entry.deps.some((dep) =>
          pendingEntities.has(dep),
        );
        if (shouldInvalidate) {
          queryClient.invalidateQueries({ queryKey: [...entry.queryKey] });
        }
      }
    }

    // Also invalidate entity-level queries (e.g. ['todos'])
    for (const entity of pendingEntities) {
      queryClient.invalidateQueries({ queryKey: [entity] });
    }

    // Clear pending
    pendingEntities = new Set();
    pendingRows = [];
  };

  const handleEvent = (event: DbEvent<S>) => {
    pendingEntities.add(event.entity as string);

    if (event.id) {
      pendingRows.push({ entity: event.entity as string, id: event.id });
    }

    // Schedule flush
    if (debounceMs > 0) {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(flush, debounceMs);
    } else {
      flush();
    }
  };

  // Subscribe to events
  const unsubscribe = subscribe(handleEvent);

  // Return cleanup function
  return () => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    unsubscribe();
  };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { DbEvent, Store } from '@rippledb/client';
export type { QueryClient } from '@tanstack/query-core';
