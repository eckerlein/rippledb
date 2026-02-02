# @rippledb/db-turso

Turso/libSQL database adapter for RippleDB.

📚 **Documentation:**
[rippledb.dev/docs/adapters/db-turso](https://rippledb.dev/docs/adapters/db-turso)

## Installation

```bash
npm install @rippledb/db-turso @rippledb/core @rippledb/server @libsql/client
```

## Usage

### Factory Pattern (Recommended)

```typescript
import { TursoDb } from "@rippledb/db-turso";

const db = await TursoDb.create({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// Already initialized, ready to use
```

### Constructor + Init Pattern (For Top-Level Exports)

```typescript
import { TursoDb } from "@rippledb/db-turso";

// Top-level export (works in all frameworks)
export const db = new TursoDb({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// Initialize during app startup (after migrations if needed)
await db.init();

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

- Edge-ready (works with Turso's global edge network)
- Async operations with batched transactions
- Idempotency key support
- Optional materialization

## License

MIT
