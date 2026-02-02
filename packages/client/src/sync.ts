import type { Change, RippleSchema } from "@rippledb/core";
import type { Store } from "./contracts";

export type OutboxEntry<S extends RippleSchema = RippleSchema> = {
  stream: string;
  change: Change<S>;
};

export interface Outbox<S extends RippleSchema = RippleSchema> {
  push(entry: OutboxEntry<S>): void;
  drain(stream: string): OutboxEntry<S>[];
  size(stream?: string): number;
}

export class InMemoryOutbox<
  S extends RippleSchema = RippleSchema,
> implements Outbox<S> {
  private items: OutboxEntry<S>[] = [];

  push(entry: OutboxEntry<S>) {
    this.items.push(entry);
  }

  drain(stream: string) {
    const out: OutboxEntry<S>[] = [];
    const keep: OutboxEntry<S>[] = [];
    for (const item of this.items) {
      if (item.stream === stream) out.push(item);
      else keep.push(item);
    }
    this.items = keep;
    return out;
  }

  size(stream?: string) {
    if (!stream) return this.items.length;
    return this.items.filter(i => i.stream === stream).length;
  }
}

export type SyncOnceOptions<S extends RippleSchema = RippleSchema> = {
  stream: string;
  store: Store<S>;
  remote: Remote<S>;
  cursor: string | null;
  outbox: Outbox<S>;
  limit?: number;
  idempotencyKey?: string;
};

export type SyncOnceResult = {
  nextCursor: string | null;
  pulled: number;
  pushed: number;
};

export type ReplicatorOptions<S extends RippleSchema = RippleSchema> = {
  stream: string;
  store: Store<S>;
  remote: Remote<S>;
  outbox?: Outbox<S>;
  cursor?: string | null;
  limit?: number;
  idempotencyKey?: string;
};

export type Replicator<S extends RippleSchema = RippleSchema> = {
  pushLocal(change: Change<S>): Promise<void>;
  sync(): Promise<SyncOnceResult>;
  getCursor(): string | null;
};

export type Remote<S extends RippleSchema = RippleSchema> = {
  pull(req: {
    stream: string;
    cursor: string | null;
    limit?: number;
  }): Promise<{
    changes: Change<S>[];
    nextCursor: string | null;
  }>;
  append(req: {
    stream: string;
    idempotencyKey?: string;
    changes: Change<S>[];
  }): Promise<{ accepted: number; }>;
};

/**
 * Minimal "pull → apply → push" sync step (ADR-0002).
 * - Pull changes since cursor
 * - Apply to local store
 * - Push outbox changes
 */
export async function syncOnce<S extends RippleSchema = RippleSchema>(
  opts: SyncOnceOptions<S>,
): Promise<SyncOnceResult> {
  const { stream, store, remote, cursor, outbox } = opts;

  const pulled = await remote.pull({ stream, cursor, limit: opts.limit });
  if (pulled.changes.length > 0) {
    await store.applyChanges(pulled.changes);
  }

  const pending = outbox.drain(stream).map(e => e.change);
  let pushed = 0;
  if (pending.length > 0) {
    const res = await remote.append({
      stream,
      idempotencyKey: opts.idempotencyKey,
      changes: pending,
    });
    pushed = res.accepted;
  }

  return {
    nextCursor: pulled.nextCursor,
    pulled: pulled.changes.length,
    pushed,
  };
}

/**
 * Convenience wrapper that manages cursor + outbox for a single stream.
 */
export function createReplicator<S extends RippleSchema = RippleSchema>(
  opts: ReplicatorOptions<S>,
): Replicator<S> {
  let cursor = opts.cursor ?? null;
  const outbox = opts.outbox ?? new InMemoryOutbox<S>();

  return {
    async pushLocal(change) {
      await opts.store.applyChanges([change]);
      outbox.push({ stream: opts.stream, change });
    },
    async sync() {
      const result = await syncOnce({
        stream: opts.stream,
        store: opts.store,
        remote: opts.remote,
        cursor,
        outbox,
        limit: opts.limit,
        idempotencyKey: opts.idempotencyKey,
      });
      cursor = result.nextCursor;
      return result;
    },
    getCursor() {
      return cursor;
    },
  };
}
