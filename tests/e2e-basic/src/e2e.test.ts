import { createReplicator } from "@rippledb/client";
import {
  createHlcState,
  makeDelete,
  makeUpsert,
  tickHlc,
} from "@rippledb/core";
import { MemoryDb } from "@rippledb/db-memory";
import { MemoryStore } from "@rippledb/store-memory";
import { describe, expect, it } from "vitest";

type DemoSchema = {
  todo: { id: string; title: string; };
};

function makeHlc(nodeId: string, nowMs: number) {
  const state = createHlcState(nodeId);
  return tickHlc(state, nowMs);
}

describe("rippledb e2e (memory store + memory db)", () => {
  it("replicates changes and resolves last-write-wins by HLC tags", async () => {
    const stream = "demo";
    const remote = new MemoryDb<DemoSchema>();

    const storeA = new MemoryStore<DemoSchema>();
    const storeB = new MemoryStore<DemoSchema>();

    const replA = createReplicator({ stream, store: storeA, remote });
    const replB = createReplicator({ stream, store: storeB, remote });

    // A creates a row
    const c1 = makeUpsert<DemoSchema>({
      stream,
      entity: "todo",
      entityId: "1",
      patch: { id: "1", title: "hello" },
      hlc: makeHlc("a", 1000),
    });
    await replA.pushLocal(c1);

    // B pulls it
    await replA.sync();
    await replB.sync();

    expect(await storeB.getRow("todo", "1")).toMatchObject({
      id: "1",
      title: "hello",
    });

    // B updates title later (should win)
    const c2 = makeUpsert<DemoSchema>({
      stream,
      entity: "todo",
      entityId: "1",
      patch: { title: "bye" },
      hlc: makeHlc("b", 2000),
    });
    await replB.pushLocal(c2);

    // B must push first, then A can pull.
    await replB.sync();
    await replA.sync();

    expect(await storeA.getRow("todo", "1")).toMatchObject({
      id: "1",
      title: "bye",
    });

    // Delete dominates when newer
    const c3 = makeDelete<DemoSchema>({
      stream,
      entity: "todo",
      entityId: "1",
      hlc: makeHlc("a", 3000),
    });
    await replA.pushLocal(c3);
    await replA.sync();
    await replB.sync();

    expect(await storeB.getRow("todo", "1")).toBeNull();
  });
});
