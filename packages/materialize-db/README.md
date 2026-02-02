# @rippledb/materialize-db

SQL-based state materializer for RippleDB.

📚 **Documentation:**
[rippledb.dev/docs/adapters/materialize-db](https://rippledb.dev/docs/adapters/materialize-db)

## Installation

```bash
npm install @rippledb/materialize-db @rippledb/materialize-core @rippledb/core
```

## Usage

```typescript
import { createSyncMaterializer } from "@rippledb/materialize-db";

const materializer = createSyncMaterializer({
  tableMap: { todos: "todos", users: "users" },
  executor: {
    load: (entity, id) =>
      db.get(`SELECT * FROM ${entity}_tags WHERE id = ?`, [id]),
    save: (entity, id, data, tags) => {
      /* ... */
    },
    remove: (entity, id) => {
      /* ... */
    },
  },
});

// Load, save, remove entities
const state = materializer.load("todos", "todo-1");
materializer.save("todos", "todo-1", state);
materializer.remove("todos", "todo-1", state);
```

## Features

- Works with raw SQL databases
- Sync and async executor support
- Pairs with `db-sqlite` and `db-turso`

## License

MIT
