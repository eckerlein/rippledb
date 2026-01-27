# @rippledb/db-memory

In-memory database adapter for RippleDB testing.

📚 **Documentation:** [rippledb.dev/docs/adapters/db-memory](https://rippledb.dev/docs/adapters/db-memory)

## Installation

```bash
npm install @rippledb/db-memory @rippledb/core @rippledb/server
```

## Usage

```typescript
import { MemoryDb } from '@rippledb/db-memory';

const db = new MemoryDb<MySchema>();

// Append changes
await db.append({
  stream: 'user-123',
  changes: [/* ... */],
});

// Pull changes
const { changes, nextCursor } = await db.pull({
  stream: 'user-123',
  cursor: null,
});
```

## Features

- No persistence (data lost on restart)
- Fast synchronous operations
- Idempotency key support
- Perfect for unit tests and prototyping

## License

MIT
