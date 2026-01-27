# @rippledb/core

Core primitives for RippleDB: HLC timestamps, Change types, and merge logic.

📚 **Documentation:** [rippledb.dev/docs/reference/core](https://rippledb.dev/docs/reference/core)

## Installation

```bash
npm install @rippledb/core
```

## Usage

```typescript
import { 
  createHlcState, 
  tickHlc, 
  makeUpsert, 
  makeDelete 
} from '@rippledb/core';

// Create HLC state for a node
const hlcState = createHlcState('node-1');

// Generate a timestamp
const hlc = tickHlc(hlcState, Date.now());

// Create changes
const upsert = makeUpsert({
  stream: 'user-123',
  entity: 'todos',
  entityId: 'todo-1',
  patch: { title: 'Buy milk', done: false },
  hlc,
});

const deletion = makeDelete({
  stream: 'user-123',
  entity: 'todos',
  entityId: 'todo-1',
  hlc,
});
```

## Exports

| Export | Description |
|--------|-------------|
| `createHlcState` | Create HLC state for a node |
| `tickHlc` | Generate next HLC timestamp |
| `compareHlc` | Compare two HLC timestamps |
| `makeUpsert` | Create an upsert change |
| `makeDelete` | Create a delete change |
| `RippleSchema` | Type for entity schemas |
| `Change` | Type for changes |
| `Hlc` | Type for HLC timestamps |

## License

MIT
