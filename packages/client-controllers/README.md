# @rippledb/client-controllers

Abstract CRUD controllers with batch loading for RippleDB.

📚 **Documentation:**
[rippledb.dev/docs/adapters/controllers](https://rippledb.dev/docs/adapters/controllers)

## Installation

```bash
npm install @rippledb/client-controllers
```

## Usage

```typescript
import { createEntityController } from "@rippledb/client-controllers";
import { MemoryStore } from "@rippledb/store-memory";

const store = new MemoryStore<MySchema>();

// Create a controller for an entity type
const todoController = createEntityController({
  store,
  entity: "todos",
  stream: "user-123",
});

// CRUD operations with automatic batch loading
const todo = await todoController.create({ title: "Buy milk" });
const fetched = await todoController.read(todo.id);
const updated = await todoController.update(todo.id, { done: true });
await todoController.delete(todo.id);
```

## Features

- **Batch loading**: Multiple `read()` calls in the same tick are automatically
  batched
- **CRUD operations**: Simple, type-safe create/read/update/delete API
- **Framework agnostic**: Works with any UI framework or backend
- **Store abstraction**: Works with any `Store` implementation

## Relationship to bind-tanstack-query

- **Controllers**: Handle reads/writes and batch loading (data access layer)
- **bind-tanstack-query**: Handles cache invalidation (UI reactivity layer)

Use controllers for CRUD operations, and `bind-tanstack-query` for automatic
cache invalidation.

## License

MIT
