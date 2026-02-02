import {
  createHlcState,
  makeDelete,
  makeUpsert,
  tickHlc,
} from "@rippledb/core";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "./index";

type TestSchema = {
  todos: { id: string; title: string };
};

describe("MemoryStore getRows", () => {
  it("returns multiple rows for existing ids and skips missing ones", async () => {
    const store = new MemoryStore<TestSchema>();
    const state = createHlcState("test-node");
    let now = Date.now();

    await store.applyChanges([
      makeUpsert({
        stream: "s",
        entity: "todos",
        entityId: "1",
        patch: { id: "1", title: "One" },
        hlc: tickHlc(state, now++),
      }),
      makeUpsert({
        stream: "s",
        entity: "todos",
        entityId: "2",
        patch: { id: "2", title: "Two" },
        hlc: tickHlc(state, now++),
      }),
    ]);

    const rows = await store.getRows("todos", ["1", "2", "missing"]);

    expect(rows.size).toBe(2);
    expect(rows.get("1")).toEqual({ id: "1", title: "One" });
    expect(rows.get("2")).toEqual({ id: "2", title: "Two" });
    expect(rows.has("missing")).toBe(false);
  });

  it("does not return deleted rows", async () => {
    const store = new MemoryStore<TestSchema>();
    const state = createHlcState("test-node");
    let now = Date.now();

    await store.applyChanges([
      makeUpsert({
        stream: "s",
        entity: "todos",
        entityId: "1",
        patch: { id: "1", title: "One" },
        hlc: tickHlc(state, now++),
      }),
    ]);

    // Delete the row
    await store.applyChanges([
      makeDelete({
        stream: "s",
        entity: "todos",
        entityId: "1",
        hlc: tickHlc(state, now++),
      }),
    ]);

    const rows = await store.getRows("todos", ["1"]);
    expect(rows.size).toBe(0);
  });
});
