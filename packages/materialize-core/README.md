# @rippledb/materialize-core

Core materialization logic for RippleDB using per-field LWW.

📚 **Documentation:**
[rippledb.dev/docs/adapters/materialize-core](https://rippledb.dev/docs/adapters/materialize-core)

## Installation

```bash
npm install @rippledb/materialize-core @rippledb/core
```

## Usage

```typescript
import {
  applyChangeToState,
  materializeChange,
} from "@rippledb/materialize-core";

// Low-level: apply a single change to state
const { state, changed, deleted } = applyChangeToState(currentState, change);

// High-level: materialize with an adapter
await materializeChange(adapter, change);
```

## Exports

| Export                | Description                             |
| --------------------- | --------------------------------------- |
| `applyChangeToState`  | Apply change to entity state using LWW  |
| `materializeChange`   | Materialize a single change via adapter |
| `materializeChanges`  | Materialize multiple changes            |
| `MaterializerState`   | Type for entity state with LWW tags     |
| `MaterializerAdapter` | Interface for storage adapters          |

## License

MIT
