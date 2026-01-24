import type { Change, ConvergeSchema } from '@converge/core';
import type { AppendRequest, AppendResult, Cursor, Db, PullRequest, PullResponse } from '@converge/server';

type Entry<S extends ConvergeSchema> = {
  seq: number;
  change: Change<S>;
};

type StreamState<S extends ConvergeSchema> = {
  nextSeq: number;
  entries: Entry<S>[];
  idempotency: Map<string, number>; // key -> last accepted seq
};

function encodeCursor(seq: number): Cursor {
  return String(seq);
}

function decodeCursor(cursor: Cursor | null): number {
  if (!cursor) return 0;
  const n = Number(cursor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export class MemoryDb<S extends ConvergeSchema = ConvergeSchema> implements Db<S> {
  private streams = new Map<string, StreamState<S>>();

  async append(req: AppendRequest<S>): Promise<AppendResult> {
    const state = this.getStream(req.stream);

    if (req.idempotencyKey) {
      const seen = state.idempotency.get(req.idempotencyKey);
      if (seen) {
        return { accepted: 0 };
      }
    }

    for (const change of req.changes) {
      state.entries.push({ seq: state.nextSeq++, change });
    }

    if (req.idempotencyKey) {
      state.idempotency.set(req.idempotencyKey, state.nextSeq - 1);
    }

    return { accepted: req.changes.length };
  }

  async pull(req: PullRequest): Promise<PullResponse<S>> {
    const state = this.getStream(req.stream);
    const afterSeq = decodeCursor(req.cursor);
    const limit = req.limit ?? 500;

    const startIdx = state.entries.findIndex((e) => e.seq > afterSeq);
    if (startIdx === -1) return { changes: [], nextCursor: req.cursor };

    const slice = state.entries.slice(startIdx, startIdx + limit);
    const changes = slice.map((e) => e.change);
    const last = slice[slice.length - 1];

    return {
      changes,
      nextCursor: last ? encodeCursor(last.seq) : req.cursor,
    };
  }

  private getStream(stream: string): StreamState<S> {
    let st = this.streams.get(stream);
    if (!st) {
      st = { nextSeq: 1, entries: [], idempotency: new Map() };
      this.streams.set(stream, st);
    }
    return st;
  }
}

