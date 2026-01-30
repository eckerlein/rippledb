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

// Create a store with a file path
const store = new SqliteStore<MySchema>({
  filename: './data.db',
});

// Or use an in-memory database
const store = new SqliteStore<MySchema>({
  filename: ':memory:',
});

// Or provide an existing better-sqlite3 Database instance
import Database from 'better-sqlite3';
const db = new Database('./data.db');
const store = new SqliteStore<MySchema>({ db });

// Subscribe to events
const unsubscribe = store.onEvent((event) => {
  console.log('Change:', event.entity, event.kind, event.id);
});

// Apply changes
await store.applyChanges([change]);

// Query data
const todo = await store.getRow('todos', 'todo-1');
const todos = await store.getRows('todos', ['todo-1', 'todo-2']);

// List rows with SQL
const allTodos = await store.listRows('SELECT data FROM todos WHERE deleted = 0');

// Close the database when done (only if store owns the connection)
store.close();
```

## Options

### `filename?: string`

SQLite database file path or `:memory:` for an in-memory database. If not provided, defaults to `:memory:`.

### `db?: Database`

Existing `better-sqlite3` Database instance. If provided, `filename` is ignored and the store will not close the database connection.

### `pragmas?: string[]`

SQLite pragmas to apply when creating a new database connection. Defaults to `['journal_mode = WAL']`.

## Features

- Implements the `Store` interface from `@rippledb/client`
- Persistent storage with SQLite
- Emits `DbEvent`s for UI reactivity
- Efficient bulk reads with `getRows`
- SQL queries with `listRows`
- Transactional writes with `applyChanges`

## License

MIT
