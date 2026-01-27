# @rippledb/client

Client-side sync orchestration for RippleDB.

📚 **Documentation:** [rippledb.dev/docs/reference/client](https://rippledb.dev/docs/reference/client)

## Installation

```bash
npm install @rippledb/client @rippledb/core
```

## Usage

```typescript
import { createReplicator, syncOnce } from '@rippledb/client';

// Create a replicator for continuous sync
const replicator = createReplicator({
  stream: 'user-123',
  store,   // Local Store implementation
  remote,  // Remote implementation (HTTP, tRPC, etc.)
});

// Push local changes and pull remote changes
await replicator.sync();

// Or use syncOnce for one-shot sync
const result = await syncOnce({ stream: 'user-123', store, remote });
```

## Exports

| Export | Description |
|--------|-------------|
| `createReplicator` | Create a replicator for continuous sync |
| `syncOnce` | One-shot sync operation |
| `Store` | Interface for local truth store |
| `Remote` | Interface for remote sync endpoint |
| `DbEvent` | Event emitted after store changes |

## License

MIT
