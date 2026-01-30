# @rippledb/store-sqlite

SQLite-based client-side Store for RippleDB with persistent storage and SQL WHERE clauses.

📚 **Documentation:** [rippledb.dev/docs/adapters/store-sqlite](https://rippledb.dev/docs/adapters/store-sqlite)

## Installation

```bash
npm install @rippledb/store-sqlite @rippledb/client @rippledb/core better-sqlite3
```

## Usage

```typescript
import { SqliteStore } from '@rippledb/store-sqlite';
import { defineSchema, s, InferSchema } from '@rippledb/core';

// Define your schema (same as backend!)
const schema = defineSchema({
  todos: {
    id: s.string(),
    title: s.string(),
    done: s.boolean(),
  },
});

type MySchema = InferSchema<typeof schema>;

// Create store with schema (required)
const store = new SqliteStore({
  filename: './data.db',
  schema, // Required - creates tables with proper columns
});

// Subscribe to events
const unsubscribe = store.onEvent((event) => {
  console.log('Change:', event.entity, event.kind, event.id);
});

// Apply changes (properly type-checked!)
await store.applyChanges([change]);

// Query data
const todo = await store.getRow('todos', 'todo-1');
const todos = await store.getRows('todos', ['todo-1', 'todo-2']);

// SQL queries with WHERE clauses!
const activeTodos = await store.listRows(
  'SELECT * FROM todos WHERE done = 0 AND deleted = 0'
);

// Close the database when done (only if store owns the connection)
store.close();
```

## Options

### `schema: SchemaDescriptor` (required)

Schema descriptor for creating domain tables with proper columns. Required to enable SQL WHERE clauses. Use the same schema descriptor as your backend for consistency.

```typescript
const schema = defineSchema({
  todos: {
    id: s.string(),
    title: s.string(),
    done: s.boolean(),
  },
});

const store = new SqliteStore({
  schema, // Required
});
```

### `filename?: string`

SQLite database file path or `:memory:` for an in-memory database. Defaults to `:memory:`.

```typescript
// File-based storage
const store = new SqliteStore({
  filename: './data.db',
  schema,
});

// In-memory (data lost on close)
const store = new SqliteStore({
  filename: ':memory:',
  schema,
});
```

### `db?: Database`

Existing `better-sqlite3` Database instance. If provided, `filename` is ignored and the store will not close the database connection.

```typescript
import Database from 'better-sqlite3';

const db = new Database('./data.db');
const store = new SqliteStore({
  db,
  schema,
});
```

### `pragmas?: string[]`

SQLite pragmas to apply when creating a new database connection. Defaults to `['journal_mode = WAL']`.

```typescript
const store = new SqliteStore({
  filename: './data.db',
  schema,
  pragmas: ['journal_mode = WAL', 'foreign_keys = ON'],
});
```

### `tagsTable?: string`

Name of the tags table for HLC conflict resolution. Defaults to `'ripple_tags'`.

```typescript
const store = new SqliteStore({
  filename: './data.db',
  schema,
  tagsTable: 'custom_tags_table',
});
```

### `fieldMap?: Record<EntityName, Record<string, string>>`

Optional field mapping from schema field names to database column names. Useful for naming conventions (e.g., camelCase → snake_case).

```typescript
const store = new SqliteStore({
  filename: './data.db',
  schema,
  fieldMap: {
    todos: {
      userId: 'user_id',        // camelCase → snake_case
      createdAt: 'created_at',  // camelCase → snake_case
      isDone: 'is_done',         // camelCase → snake_case
    },
  },
});

// Schema uses: userId, createdAt, isDone
// Database columns: user_id, created_at, is_done
// SQL queries use column names:
const todos = await store.listRows(
  'SELECT * FROM todos WHERE user_id = ? AND is_done = 0'
);
```

## Features

- ✅ Implements the `Store` interface from `@rippledb/client`
- ✅ Persistent storage with SQLite
- ✅ Emits `DbEvent`s for UI reactivity
- ✅ Efficient bulk reads with `getRows`
- ✅ SQL WHERE clauses on actual columns
- ✅ Transactional writes with `applyChanges`
- ✅ Type-safe: infers schema from descriptor
- ✅ Field-level conflict resolution with HLC

## SQL Queries

With a schema descriptor, you can use SQL WHERE clauses on actual columns:

```typescript
// Query with WHERE clause
const activeTodos = await store.listRows(
  'SELECT * FROM todos WHERE done = 0 AND deleted = 0'
);

// Query with JOINs
const todosWithUsers = await store.listRows(
  `SELECT t.*, u.name as user_name 
   FROM todos t 
   JOIN users u ON t.user_id = u.id 
   WHERE t.deleted = 0`
);
```

**Security**: The `listRows` method executes raw SQL. If queries come from untrusted sources, validate/whitelist them to prevent SQL injection.

## Comparison with store-memory

| Feature | store-memory | store-sqlite |
|---------|--------------|--------------|
| Persistence | ❌ No | ✅ Yes |
| SQL WHERE clauses | ❌ No | ✅ Yes |
| Schema required | ❌ No | ✅ Yes |
| Best for | Tests, prototypes | Production apps |

## License

MIT
