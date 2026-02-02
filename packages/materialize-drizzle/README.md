# @rippledb/materialize-drizzle

Type-safe Drizzle ORM materializer for RippleDB.

📚 **Documentation:**
[rippledb.dev/docs/adapters/materialize-drizzle](https://rippledb.dev/docs/adapters/materialize-drizzle)

## Installation

```bash
npm install @rippledb/materialize-drizzle @rippledb/materialize-core @rippledb/core drizzle-orm
```

## Usage

```typescript
import { DrizzleDb } from "@rippledb/db-drizzle";

const rippleDb = new DrizzleDb({
  db: drizzle(sqlite),
  changesTable,
  idempotencyTable,
  getTableConfig,
  materializer: ({ db }) => ({
    tableMap: { todos: "todos" },
    executor: createDrizzleMaterializerExecutor({ db, tagsTable, todosTable }),
  }),
});
```

## Features

- Type-safe with Drizzle schemas
- Automatic table mapping
- Pairs with `db-drizzle`

## License

MIT
