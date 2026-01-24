import type { Change } from '@converge/core';
import type { Store } from './contracts';

export type OutboxEntry = {
  stream: string;
  change: Change;
};

export interface Outbox {
  push(entry: OutboxEntry): void;
  drain(stream: string): OutboxEntry[];
  size(stream?: string): number;
}

export class InMemoryOutbox implements Outbox {
  private items: OutboxEntry[] = [];

  push(entry: OutboxEntry) {
    this.items.push(entry);
  }

  drain(stream: string) {
    const out: OutboxEntry[] = [];
    const keep: OutboxEntry[] = [];
    for (const item of this.items) {
      if (item.stream === stream) out.push(item);
      else keep.push(item);
    }
    this.items = keep;
    return out;
  }

  size(stream?: string) {
    if (!stream) return this.items.length;
    return this.items.filter((i) => i.stream === stream).length;
  }
}

export type SyncOnceOptions = {
  stream: string;
  store: Store;
  remote: {
    pull(req: { stream: string; cursor: string | null; limit?: number }): Promise<{
      changes: Change[];
      nextCursor: string | null;
    }>;
    append(req: { stream: string; idempotencyKey?: string; changes: Change[] }): Promise<{ accepted: number }>;
  };
  cursor: string | null;
  outbox: Outbox;
  limit?: number;
  idempotencyKey?: string;
};

export type SyncOnceResult = {
  nextCursor: string | null;
  pulled: number;
  pushed: number;
};

/**
 * Minimal "pull → apply → push" sync step (ADR-0002).
 * - Pull changes since cursor
 * - Apply to local store
 * - Push outbox changes
 */
export async function syncOnce(opts: SyncOnceOptions): Promise<SyncOnceResult> {
  const { stream, store, remote, cursor, outbox } = opts;

  const pulled = await remote.pull({ stream, cursor, limit: opts.limit });
  if (pulled.changes.length > 0) {
    await store.applyChanges(pulled.changes);
  }

  const pending = outbox.drain(stream).map((e) => e.change);
  let pushed = 0;
  if (pending.length > 0) {
    const res = await remote.append({ stream, idempotencyKey: opts.idempotencyKey, changes: pending });
    pushed = res.accepted;
  }

  return { nextCursor: pulled.nextCursor, pulled: pulled.changes.length, pushed };
}

