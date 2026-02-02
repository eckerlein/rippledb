import { createHlcState, makeUpsert, tickHlc } from "@rippledb/core";
import { MemoryStore } from "@rippledb/store-memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBatchLoader, createEntityController } from "./index";

type TestSchema = {
  todos: { id: string; title: string; done: boolean };
  users: { id: string; name: string };
};

describe("createBatchLoader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches multiple load calls in the same tick", async () => {
    const store = new MemoryStore<TestSchema>();
    const state = createHlcState("test-node");
    let now = Date.now();

    // Create some test data
    await store.applyChanges([
      makeUpsert({
        stream: "s",
        entity: "todos",
        entityId: "1",
        patch: { id: "1", title: "One", done: false },
        hlc: tickHlc(state, now++),
      }),
      makeUpsert({
        stream: "s",
        entity: "todos",
        entityId: "2",
        patch: { id: "2", title: "Two", done: false },
        hlc: tickHlc(state, now++),
      }),
    ]);

    const batchLoader = createBatchLoader(store, "todos");

    // Multiple loads in the same tick
    const p1 = batchLoader.load("1");
    const p2 = batchLoader.load("2");
    const p3 = batchLoader.load("1"); // Duplicate

    // Advance microtask queue
    await vi.runAllTimersAsync();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    // Results should be correct (batching is an implementation detail)
    expect(r1).toEqual({ id: "1", title: "One", done: false });
    expect(r2).toEqual({ id: "2", title: "Two", done: false });
    expect(r3).toEqual({ id: "1", title: "One", done: false });
  });

  it("loadMany executes immediately without batching", async () => {
    const store = new MemoryStore<TestSchema>();
    const state = createHlcState("test-node");
    let now = Date.now();

    await store.applyChanges([
      makeUpsert({
        stream: "s",
        entity: "todos",
        entityId: "1",
        patch: { id: "1", title: "One", done: false },
        hlc: tickHlc(state, now++),
      }),
      makeUpsert({
        stream: "s",
        entity: "todos",
        entityId: "2",
        patch: { id: "2", title: "Two", done: false },
        hlc: tickHlc(state, now++),
      }),
    ]);

    const batchLoader = createBatchLoader(store, "todos");

    const results = await batchLoader.loadMany(["1", "2"]);

    expect(results.size).toBe(2);
    expect(results.get("1")).toEqual({ id: "1", title: "One", done: false });
    expect(results.get("2")).toEqual({ id: "2", title: "Two", done: false });
  });
});

describe("createEntityController", () => {
  it("creates an entity", async () => {
    const store = new MemoryStore<TestSchema>();
    const controller = createEntityController({
      store,
      entity: "todos",
      stream: "test-stream",
    });

    const todo = await controller.create({ title: "Buy milk", done: false });

    expect(todo.id).toBeDefined();
    expect(todo.title).toBe("Buy milk");
    expect(todo.done).toBe(false);

    // Verify it's in the store
    const fetched = await controller.read(todo.id);
    expect(fetched).toEqual(todo);
  });

  it("uses provided ID from patch if present", async () => {
    const store = new MemoryStore<TestSchema>();
    const controller = createEntityController({
      store,
      entity: "todos",
      stream: "test-stream",
    });

    const todo = await controller.create({
      id: "custom-id",
      title: "Test",
      done: false,
    });

    expect(todo.id).toBe("custom-id");
  });

  it("reads an entity", async () => {
    const store = new MemoryStore<TestSchema>();
    const controller = createEntityController({
      store,
      entity: "todos",
      stream: "test-stream",
    });

    const created = await controller.create({ title: "Test", done: false });
    const read = await controller.read(created.id);

    expect(read).toEqual(created);
  });

  it("returns null for non-existent entity", async () => {
    const store = new MemoryStore<TestSchema>();
    const controller = createEntityController({
      store,
      entity: "todos",
      stream: "test-stream",
    });

    const read = await controller.read("non-existent");
    expect(read).toBeNull();
  });

  it("reads multiple entities", async () => {
    const store = new MemoryStore<TestSchema>();
    const controller = createEntityController({
      store,
      entity: "todos",
      stream: "test-stream",
    });

    const todo1 = await controller.create({ title: "One", done: false });
    const todo2 = await controller.create({ title: "Two", done: false });

    const results = await controller.readMany([todo1.id, todo2.id, "missing"]);

    expect(results.size).toBe(2);
    expect(results.get(todo1.id)).toEqual(todo1);
    expect(results.get(todo2.id)).toEqual(todo2);
    expect(results.has("missing")).toBe(false);
  });

  it("updates an entity", async () => {
    const store = new MemoryStore<TestSchema>();
    const controller = createEntityController({
      store,
      entity: "todos",
      stream: "test-stream",
    });

    const created = await controller.create({ title: "Original", done: false });
    const updated = await controller.update(created.id, { done: true });

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("Original");
    expect(updated.done).toBe(true);
  });

  it("deletes an entity", async () => {
    const store = new MemoryStore<TestSchema>();
    const controller = createEntityController({
      store,
      entity: "todos",
      stream: "test-stream",
    });

    const created = await controller.create({
      title: "To delete",
      done: false,
    });
    await controller.delete(created.id);

    const read = await controller.read(created.id);
    expect(read).toBeNull();
  });

  it("lists entities", async () => {
    const store = new MemoryStore<TestSchema>();
    const controller = createEntityController({
      store,
      entity: "todos",
      stream: "test-stream",
    });

    await controller.create({ title: "One", done: false });
    await controller.create({ title: "Two", done: true });

    const todos = await controller.list({ entity: "todos" });

    expect(todos.length).toBe(2);
    expect(todos.some((t) => t.title === "One")).toBe(true);
    expect(todos.some((t) => t.title === "Two")).toBe(true);
  });

  it("batches multiple read calls", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore<TestSchema>();
    const controller = createEntityController({
      store,
      entity: "todos",
      stream: "test-stream",
    });

    const todo1 = await controller.create({ title: "One", done: false });
    const todo2 = await controller.create({ title: "Two", done: false });

    // Multiple reads in the same tick
    const p1 = controller.read(todo1.id);
    const p2 = controller.read(todo2.id);
    const p3 = controller.read(todo1.id); // Duplicate

    await vi.runAllTimersAsync();
    vi.useRealTimers();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    // Results should be correct (batching is an implementation detail)
    expect(r1).toEqual(todo1);
    expect(r2).toEqual(todo2);
    expect(r3).toEqual(todo1);
  });
});
