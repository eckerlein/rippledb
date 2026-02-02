import { createReplicator } from "@rippledb/client";
import {
  createHlcState,
  makeDelete,
  makeUpsert,
  tickHlc,
} from "@rippledb/core";
import { MemoryDb } from "@rippledb/db-memory";
import { createTrpcRemote } from "@rippledb/remote-trpc";
import { createRippleTrpcRouter } from "@rippledb/server-trpc";
import { MemoryStore } from "@rippledb/store-memory";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

type DemoSchema = {
  todo: { id: string; title: string; };
};

function makeHlc(nodeId: string, nowMs: number) {
  const state = createHlcState(nodeId);
  return tickHlc(state, nowMs);
}

describe("rippledb trpc e2e (memory db server + trpc remote)", () => {
  it("syncs over tRPC with two clients", async () => {
    // Set up server-side
    const db = new MemoryDb<DemoSchema>();
    const rippleRouter = createRippleTrpcRouter({ db });

    // Create a tRPC caller for testing (no HTTP needed)
    const t = initTRPC.create();
    const appRouter = t.router({ ripple: rippleRouter });
    const caller = appRouter.createCaller({});

    // Set up client-side — clean API!
    const remote = createTrpcRemote<DemoSchema>({
      pull: caller.ripple.pull,
      append: caller.ripple.append,
    });

    const storeA = new MemoryStore<DemoSchema>();
    const storeB = new MemoryStore<DemoSchema>();
    const replA = createReplicator({ stream: "demo", store: storeA, remote });
    const replB = createReplicator({ stream: "demo", store: storeB, remote });

    // Test 1: Client A creates a todo, Client B sees it
    const c1 = makeUpsert<DemoSchema>({
      stream: "demo",
      entity: "todo",
      entityId: "1",
      patch: { id: "1", title: "hello" },
      hlc: makeHlc("a", 1000),
    });
    await replA.pushLocal(c1);
    await replA.sync();
    await replB.sync();
    expect(await storeB.getRow("todo", "1")).toMatchObject({
      id: "1",
      title: "hello",
    });

    // Test 2: Client B updates the todo, Client A sees it
    const c2 = makeUpsert<DemoSchema>({
      stream: "demo",
      entity: "todo",
      entityId: "1",
      patch: { title: "bye" },
      hlc: makeHlc("b", 2000),
    });
    await replB.pushLocal(c2);
    await replB.sync();
    await replA.sync();
    expect(await storeA.getRow("todo", "1")).toMatchObject({
      id: "1",
      title: "bye",
    });

    // Test 3: Client A deletes the todo, Client B sees it
    const c3 = makeDelete<DemoSchema>({
      stream: "demo",
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
