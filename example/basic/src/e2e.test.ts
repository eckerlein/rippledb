import { InMemoryOutbox, syncOnce } from '@converge/client';
import type { Change } from '@converge/core';
import { createHlcState, tickHlc } from '@converge/core';
import { MemoryDb } from '@converge/db-memory';
import { MemoryStore } from '@converge/store-memory';
import { describe, expect, it } from 'vitest';

function makeUpsert(opts: {
  stream: string;
  entity: string;
  entityId: string;
  patch: Record<string, unknown>;
  nowMs: number;
  nodeId: string;
}): Change {
  const state = createHlcState(opts.nodeId);
  const hlc = tickHlc(state, opts.nowMs);
  return {
    stream: opts.stream,
    entity: opts.entity,
    entityId: opts.entityId,
    kind: 'upsert',
    patch: opts.patch,
    tags: Object.fromEntries(Object.keys(opts.patch).map((k) => [k, hlc])),
    hlc,
  };
}

function makeDelete(opts: {
  stream: string;
  entity: string;
  entityId: string;
  nowMs: number;
  nodeId: string;
}): Change {
  const state = createHlcState(opts.nodeId);
  const hlc = tickHlc(state, opts.nowMs);
  return {
    stream: opts.stream,
    entity: opts.entity,
    entityId: opts.entityId,
    kind: 'delete',
    patch: {},
    tags: {},
    hlc,
  };
}

describe('converge e2e (memory store + memory db)', () => {
  it('replicates changes and resolves last-write-wins by HLC tags', async () => {
    const stream = 'demo';
    const remote = new MemoryDb();

    const storeA = new MemoryStore();
    const storeB = new MemoryStore();

    const outboxA = new InMemoryOutbox();
    const outboxB = new InMemoryOutbox();

    // A creates a row
    const c1 = makeUpsert({
      stream,
      entity: 'todo',
      entityId: '1',
      patch: { id: '1', title: 'hello' },
      nowMs: 1000,
      nodeId: 'a',
    });
    await storeA.applyChanges([c1]);
    outboxA.push({ stream, change: c1 });

    // B pulls it
    let cursorA: string | null = null;
    let cursorB: string | null = null;

    await syncOnce({ stream, store: storeA, remote, cursor: cursorA, outbox: outboxA });
    const rB1 = await syncOnce({ stream, store: storeB, remote, cursor: cursorB, outbox: outboxB });
    cursorB = rB1.nextCursor;

    expect(await storeB.getRow('todo', '1')).toMatchObject({ id: '1', title: 'hello' });

    // B updates title later (should win)
    const c2 = makeUpsert({
      stream,
      entity: 'todo',
      entityId: '1',
      patch: { title: 'bye' },
      nowMs: 2000,
      nodeId: 'b',
    });
    await storeB.applyChanges([c2]);
    outboxB.push({ stream, change: c2 });

    // B must push first, then A can pull.
    const rBpush = await syncOnce({ stream, store: storeB, remote, cursor: cursorB, outbox: outboxB });
    cursorB = rBpush.nextCursor;

    const rApull = await syncOnce({ stream, store: storeA, remote, cursor: cursorA, outbox: outboxA });
    cursorA = rApull.nextCursor;

    expect(await storeA.getRow('todo', '1')).toMatchObject({ id: '1', title: 'bye' });

    // Delete dominates when newer
    const c3 = makeDelete({
      stream,
      entity: 'todo',
      entityId: '1',
      nowMs: 3000,
      nodeId: 'a',
    });
    await storeA.applyChanges([c3]);
    outboxA.push({ stream, change: c3 });

    await syncOnce({ stream, store: storeA, remote, cursor: cursorA, outbox: outboxA });
    const rB2 = await syncOnce({ stream, store: storeB, remote, cursor: cursorB, outbox: outboxB });
    cursorB = rB2.nextCursor;

    expect(await storeB.getRow('todo', '1')).toBeNull();
  });
});

