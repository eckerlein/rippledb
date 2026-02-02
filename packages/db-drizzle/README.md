# @rippledb/db-drizzle

Database-agnostic Drizzle ORM adapter for RippleDB.

📚 **Documentation:**
[rippledb.dev/docs/adapters/db-drizzle](https://rippledb.dev/docs/adapters/db-drizzle)

## Installation

```bash
npm install @rippledb/db-drizzle @rippledb/core @rippledb/server drizzle-orm
```

## Usage

```typescript
import { DrizzleDb } from "@rippledb/db-drizzle";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { getTableConfig } from "drizzle-orm/sqlite-core";

// Define your tables
const changesTable = sqliteTable("ripple_changes", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  stream: text("stream").notNull(),
  change_json: text("change_json").notNull(),
});

const idempotencyTable = sqliteTable("ripple_idempotency", {
  stream: text("stream").notNull(),
  idempotency_key: text("idempotency_key").notNull(),
  last_seq: integer("last_seq").notNull(),
});

// Create the adapter
const rippleDb = new DrizzleDb({
  db: drizzle(sqlite),
  changesTable,
  idempotencyTable,
  getTableConfig,
  isSync: true, // For better-sqlite3
});
```

## Features

- Works with any Drizzle-supported database (SQLite, PostgreSQL, MySQL)
- Type-safe with full TypeScript support
- Supports both sync (better-sqlite3) and async drivers
- Optional materialization with Drizzle schemas

## License

MIT
