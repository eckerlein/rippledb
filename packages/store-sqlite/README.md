# @rippledb/store-sqlite

SQLite-based client-side Store for RippleDB with persistent storage.

📚 **Documentation:** [rippledb.dev/docs/adapters/store-sqlite](https://rippledb.dev/docs/adapters/store-sqlite)

## Installation

```bash
npm install @rippledb/store-sqlite @rippledb/client @rippledb/core better-sqlite3
```

## Usage

```typescript
import { SqliteStore } from '@rippledb/store-sqlite';
import { defineSchema, s } from '@rippledb/core';

const schema = defineSchema({
  todos: {
    id: s.string(),
    title: s.string(),
    done: s.boolean(),
  },
});

const store = new SqliteStore({
  filename: './data.db',
  schema, // Required - creates tables with proper columns
});

// Subscribe to events
const unsubscribe = store.onEvent((event) => {
  console.log('Change:', event.entity, event.kind, event.id);
});

// Apply changes
await store.applyChanges([change]);

// Query data
const todo = await store.getRow('todos', 'todo-1');
const todos = await store.getRows('todos', ['todo-1', 'todo-2']);

// SQL queries with WHERE clauses
const activeTodos = await store.listRows(
  'SELECT * FROM todos WHERE done = 0 AND deleted = 0'
);
```

## Features

- Implements the `Store` interface from `@rippledb/client`
- Persistent storage with SQLite
- SQL WHERE clauses on actual columns
- Type-safe: infers schema from descriptor
- Field-level conflict resolution with HLC

## License

MIT
