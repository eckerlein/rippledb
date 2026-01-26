# RippleDB

A **local-first sync engine** with field-level conflict resolution.

RippleDB treats local storage as the source of truth. Changes replicate via an append-only log, and conflicts resolve deterministically at the field level using hybrid logical clocks (HLC).

## Features

- **Local-first** — Your app works offline. Local writes are instant.
- **Field-level LWW** — Conflicts resolve per-field, not per-row. No data loss.
- **Append-only log** — Simple, auditable replication primitive.
- **Modular & headless** — Core logic has zero dependencies. Bring your own database.
- **Framework agnostic** — Works with any UI framework or backend.


## Documentation

Full documentation available at [rippledb.dev](https://rippledb.dev/docs/) or self-host with `pnpm dev`

## Install

```bash
pnpm add @rippledb/core @rippledb/server @rippledb/db-sqlite
```

## Quick Example

```typescript
import { SqliteDb } from '@rippledb/db-sqlite';
import { createMaterializerConfig } from '@rippledb/materialize-db';

const db = new SqliteDb({
  filename: './data.db',
  materializer: ({ db }) => createMaterializerConfig({ db }),
});

// Append a change
await db.append('my-stream', [{
  entity: 'todos',
  entityId: 'todo-1',
  kind: 'upsert',
  patch: { title: 'Buy milk', done: false },
  tags: { title: hlc(), done: hlc() },
  hlc: hlc(),
}]);

// Pull changes
const { changes } = await db.pull({ streams: ['my-stream'], since: 0 });
```

## Packages

**Core** (interfaces & pure logic):

| Package | Description |
|---------|-------------|
| `@rippledb/core` | HLC, Change types, pure merge logic |
| `@rippledb/server` | Db interface, append/pull contracts |
| `@rippledb/client` | Store interface, sync orchestration |

**Database Adapters**:

| Package | Description |
|---------|-------------|
| `@rippledb/db-sqlite` | SQLite via better-sqlite3 |
| `@rippledb/db-turso` | Turso (libSQL) with batching |
| `@rippledb/db-drizzle` | Any Drizzle-supported database |
| `@rippledb/db-memory` | In-memory (for testing) |

**Materializers**:

| Package | Description |
|---------|-------------|
| `@rippledb/materialize-db` | SQL-based state projection |
| `@rippledb/materialize-drizzle` | Drizzle ORM state projection |

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm dev        # Start docs site
```

## License

MIT
