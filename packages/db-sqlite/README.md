# @rippledb/db-sqlite

SQLite database adapter for RippleDB using better-sqlite3.

📚 **Documentation:**
[rippledb.dev/docs/adapters/db-sqlite](https://rippledb.dev/docs/adapters/db-sqlite)

## Installation

```bash
npm install @rippledb/db-sqlite @rippledb/core @rippledb/server better-sqlite3
```

## Usage

```typescript
import { SqliteDb } from "@rippledb/db-sqlite";

const db = new SqliteDb({
  filename: "ripple.db",
  // Optional: custom pragmas
  pragmas: ["journal_mode = WAL"],
});

// Append changes
await db.append({
  stream: "user-123",
  changes: [
    /* ... */
  ],
});

// Pull changes
const { changes, nextCursor } = await db.pull({
  stream: "user-123",
  cursor: null,
});

// Close when done
db.close();
```

## Features

- Synchronous operations (fast, no async overhead)
- WAL mode by default for better concurrency
- Idempotency key support
- Optional materialization

## License

MIT
