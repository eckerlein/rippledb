# @rippledb/store-memory

In-memory client-side Store for RippleDB testing.

📚 **Documentation:**
[rippledb.dev/docs/adapters/store-memory](https://rippledb.dev/docs/adapters/store-memory)

## Installation

```bash
npm install @rippledb/store-memory @rippledb/client @rippledb/core
```

## Usage

```typescript
import { MemoryStore } from "@rippledb/store-memory";

const store = new MemoryStore<MySchema>();

// Subscribe to events
const unsubscribe = store.onEvent((event) => {
  console.log("Change:", event.entity, event.kind, event.id);
});

// Apply changes
await store.applyChanges([change]);

// Query data
const todo = await store.getRow("todos", "todo-1");
const todos = await store.listRows({ entity: "todos" });
```

## Features

- Implements the `Store` interface from `@rippledb/client`
- Emits `DbEvent`s for UI reactivity
- No persistence (data lost on refresh)
- Perfect for unit tests and prototyping

## License

MIT
