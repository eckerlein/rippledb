# @rippledb/bind-tanstack

TanStack Query cache invalidation binding for RippleDB.

📚 **Documentation:** [rippledb.dev/docs/adapters/bind-tanstack](https://rippledb.dev/docs/adapters/bind-tanstack)

## Installation

```bash
npm install @rippledb/bind-tanstack @tanstack/query-core
```

## Usage

```typescript
import { wireTanstackInvalidation, defineListRegistry } from '@rippledb/bind-tanstack';

// 1. Define which query keys depend on which entities
const registry = defineListRegistry()
  .list(['todos'], { deps: ['todos'] })
  .list(['dashboard'], { deps: ['todos', 'users'] });

// 2. Wire it up
const cleanup = wireTanstackInvalidation({
  queryClient,
  store,
  registry,
  debounceMs: 50,
});

// 3. Later: cleanup() to unsubscribe
```

## Features

- Works with any TanStack Query adapter (React, Vue, Solid, Svelte)
- Debounce support to coalesce rapid-fire invalidations
- Row-level (`[entity, id]`) and entity-level (`[entity]`) invalidation
- Custom list query registry for complex dependencies

## License

MIT
