import type { Store } from "@rippledb/client";
import type { EntityName, HlcState, RippleSchema } from "@rippledb/core";
import {
  createHlcState,
  makeDelete,
  makeUpsert,
  tickHlc,
} from "@rippledb/core";

/**
 * Batch loader interface for efficient bulk reads.
 * Collects keys during a tick and executes them as a single bulk query.
 */
export interface BatchLoader<K, V> {
  /**
   * Load a single key. Keys are collected per tick and batched.
   */
  load(key: K): Promise<V | null>;

  /**
   * Load multiple keys. Always executes immediately (no batching).
   */
  loadMany(keys: K[]): Promise<Map<K, V>>;
}

export type BatchLoaderFlushStrategy = "auto" | "microtask" | "raf";

export type CreateBatchLoaderOptions = {
  /**
   * How to schedule the batch flush.
   *
   * - `microtask`: flush at end of current JS turn (lowest latency, smaller batch window)
   * - `raf`: flush on next animation frame (bigger batch window, adds up to ~1 frame latency)
   * - `auto`: `raf` when available, otherwise `microtask`
   *
   * @default 'auto'
   */
  flush?: BatchLoaderFlushStrategy;
};

type PendingRequest<V> = {
  resolve: (value: V | null) => void;
  reject: (error: unknown) => void;
};

/**
 * Creates a batch loader for a specific entity in a Store.
 *
 * The batch loader collects `load()` calls during a single tick/RAF,
 * deduplicates keys, and executes them as a bulk query using `store.getRows`.
 *
 * @param store - The Store instance
 * @param entity - The entity name to load from
 * @returns A BatchLoader instance
 */
export function createBatchLoader<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
>(
  store: Store<S>,
  entity: E,
  options: CreateBatchLoaderOptions = {},
): BatchLoader<string, S[E]> {
  const pending = new Map<string, PendingRequest<S[E]>[]>();
  let scheduled = false;

  const flush = async () => {
    scheduled = false;

    if (pending.size === 0) return;

    const keys = Array.from(pending.keys());
    const requests = new Map<string, PendingRequest<S[E]>[]>();

    // Move pending requests to local map and clear
    for (const [key, reqs] of pending.entries()) {
      requests.set(key, reqs);
    }
    pending.clear();

    try {
      const uniqueKeys = Array.from(new Set(keys));
      const results = await store.getRows(entity, uniqueKeys);

      // Resolve all pending requests
      for (const [key, reqs] of requests.entries()) {
        const value = results.get(key) ?? null;
        for (const req of reqs) {
          req.resolve(value);
        }
      }
    } catch (error) {
      // Reject all pending requests on error
      for (const reqs of requests.values()) {
        for (const req of reqs) {
          req.reject(error);
        }
      }
    }
  };

  const flushStrategy: BatchLoaderFlushStrategy = options.flush ?? "auto";

  const scheduleFlush = () => {
    if (scheduled) return;
    scheduled = true;

    const raf = (
      globalThis as unknown as {
        requestAnimationFrame?: (cb: () => void) => number;
      }
    ).requestAnimationFrame;

    if (
      typeof raf === "function" &&
      (flushStrategy === "raf" || flushStrategy === "auto")
    ) {
      raf(() => {
        void flush();
      });
      return;
    }

    // Default: batch within the same tick
    queueMicrotask(() => {
      void flush();
    });
  };

  return {
    load(key: string): Promise<S[E] | null> {
      return new Promise((resolve, reject) => {
        const reqs = pending.get(key) ?? [];
        reqs.push({ resolve, reject });
        pending.set(key, reqs);
        scheduleFlush();
      });
    },

    async loadMany(keys: string[]): Promise<Map<string, S[E]>> {
      // Intentionally NOT batched:
      // - `load()` is for scattered reads and benefits from a tick/RAF batching window.
      // - `loadMany()` is the "I already have the full ID set" escape hatch and should
      //   issue exactly one bulk `getRows()` immediately (no extra scheduling latency).
      //
      // Note: If callers mix `load()` + `loadMany()` within the same frame, this may
      // cause two bulk reads (one for the flush + one for loadMany). We can add an
      // explicit opt-in like `loadMany(ids, { coalesce: true })` later if we
      // see real call-sites where this matters.
      // I see two options:
      // 1. loadMany separates each key into a separate function call to move them into the schedule.
      // 2. loadMany lets currently scheduled keys piggy back on its load call.
      const uniqueKeys = Array.from(new Set(keys));
      return await store.getRows(entity, uniqueKeys);
    },
  };
}

/**
 * Entity controller interface for CRUD operations with batch loading.
 */
export interface EntityController<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
  ListQuery = unknown,
> {
  /**
   * Create a new entity. If patch contains an `id` field, it will be used.
   * Otherwise, a UUID will be generated.
   */
  create(patch: Partial<S[E]>): Promise<S[E]>;

  /**
   * Read a single entity by ID. Uses batch loading for efficiency.
   */
  read(id: string): Promise<S[E] | null>;

  /**
   * Read multiple entities by IDs. Always executes immediately (no batching).
   */
  readMany(ids: string[]): Promise<Map<string, S[E]>>;

  /**
   * Update an entity by ID with a partial patch.
   */
  update(id: string, patch: Partial<S[E]>): Promise<S[E]>;

  /**
   * Delete an entity by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * List entities using a store-specific query.
   */
  list(query: ListQuery): Promise<S[E][]>;
}

export type CreateEntityControllerOptions<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
  ListQuery = unknown,
> = {
  /**
   * The Store instance to operate on.
   */
  store: Store<S, ListQuery>;

  /**
   * The entity name this controller manages.
   */
  entity: E;

  /**
   * The stream ID for all changes created by this controller.
   */
  stream: string;

  /**
   * Optional HLC state. If not provided, a new one will be created.
   */
  hlcState?: HlcState;

  /**
   * Optional function to generate entity IDs. Defaults to crypto.randomUUID().
   */
  generateId?: () => string;

  /**
   * Optional batch loader scheduling configuration.
   */
  batch?: CreateBatchLoaderOptions;
};

/**
 * Creates an entity controller for CRUD operations with automatic batch loading.
 *
 * @example
 * ```ts
 * const todoController = createEntityController({
 *   store,
 *   entity: 'todos',
 *   stream: 'user-123',
 * });
 *
 * const todo = await todoController.create({ title: 'Buy milk' });
 * const fetched = await todoController.read(todo.id);
 * ```
 */
export function createEntityController<
  S extends RippleSchema = RippleSchema,
  E extends EntityName<S> = EntityName<S>,
  ListQuery = unknown,
>(
  options: CreateEntityControllerOptions<S, E, ListQuery>,
): EntityController<S, E, ListQuery> {
  const {
    store,
    entity,
    stream,
    hlcState = createHlcState("controller"),
    generateId = () => crypto.randomUUID(),
    batch,
  } = options;
  const batchLoader = createBatchLoader(store, entity, batch);

  const getHlc = () => tickHlc(hlcState, Date.now());

  return {
    async create(patch: Partial<S[E]>): Promise<S[E]> {
      // Extract ID from patch if present, otherwise generate one
      const id =
        ((patch as Record<string, unknown>).id as string | undefined) ??
        generateId();
      const hlc = getHlc();

      await store.applyChanges([
        makeUpsert({
          stream,
          entity,
          entityId: id,
          patch: { ...patch, id } as Partial<S[E]>,
          hlc,
        }),
      ]);

      // Read back the created entity
      const created = await batchLoader.load(id);
      if (!created) {
        throw new Error(`Failed to read created entity ${entity}:${id}`);
      }
      return created;
    },

    read(id: string): Promise<S[E] | null> {
      return batchLoader.load(id);
    },

    readMany(ids: string[]): Promise<Map<string, S[E]>> {
      return batchLoader.loadMany(ids);
    },

    async update(id: string, patch: Partial<S[E]>): Promise<S[E]> {
      const hlc = getHlc();

      await store.applyChanges([
        makeUpsert({
          stream,
          entity,
          entityId: id,
          patch,
          hlc,
        }),
      ]);

      // Read back the updated entity
      const updated = await batchLoader.load(id);
      if (!updated) {
        throw new Error(`Failed to read updated entity ${entity}:${id}`);
      }
      return updated;
    },

    async delete(id: string): Promise<void> {
      const hlc = getHlc();

      await store.applyChanges([
        makeDelete({
          stream,
          entity,
          entityId: id,
          hlc,
        }),
      ]);
    },

    async list(query: ListQuery): Promise<S[E][]> {
      return (await store.listRows(query)) as S[E][];
    },
  };
}
