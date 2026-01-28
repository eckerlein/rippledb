# @rippledb/client-query

Final DX package combining:

- `@rippledb/client-controllers` (CRUD controllers)
- `@rippledb/bind-tanstack-query` (TanStack Query invalidation wiring)

This package is intended to be the ergonomic “one import” for client apps using RippleDB + TanStack Query.

📚 **Documentation:** [rippledb.dev/docs/reference/client-query](https://rippledb.dev/docs/reference/client-query)

## Installation

```bash
pnpm add @rippledb/client-query @tanstack/query-core
```

If you use a framework adapter (e.g. `@tanstack/react-query`), you already have `@tanstack/query-core`.

## Usage

```ts
import { QueryClient } from '@tanstack/query-core';
import { MemoryStore } from '@rippledb/store-memory';
import { defineSchema } from '@rippledb/core';
import { createClientQueryApi } from '@rippledb/client-query';

type Schema = {
  todos: { id: string; title: string; done: boolean };
  users: { id: string; name: string; email: string };
};

const store = new MemoryStore<Schema>();
const queryClient = new QueryClient();

// Runtime descriptor (entity + field discovery)
const schema = defineSchema({
  todos: { id: '', title: '', done: false },
  users: { id: '', name: '', email: '' },
});

const api = createClientQueryApi({
  store,
  stream: 'user-123',
  queryClient,
  schema,
});

// CRUD via dynamic controllers
const todo = await api.todos.create({ title: 'Buy milk', done: false });
await api.todos.update(todo.id, { done: true });

// Cached query helper + automatic invalidation
const todos = await api.query({
  key: ['todos'],
  deps: ['todos'],
  fn: () => api.todos.list({ entity: 'todos' }),
});
```

## Query registry

If you want to register “list queries” up-front (recommended), build a registry and pass it in:

```ts
import { defineListRegistry } from '@rippledb/bind-tanstack-query';

const registry = defineListRegistry()
  .list(['todos'], { deps: ['todos'] })
  .list(['dashboard'], { deps: ['todos', 'users'] });

const api = createClientQueryApi({ store, stream, queryClient, schema, registry });
```

## License

MIT

