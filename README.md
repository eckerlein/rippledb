# Converge

A **local-first sync engine** with field-level conflict resolution.

Converge treats local storage as the source of truth. Changes replicate via an append-only log, and conflicts resolve deterministically at the field level using hybrid logical clocks (HLC).

## Features

- **Local-first** — Your app works offline. Local writes are instant.
- **Field-level LWW** — Conflicts resolve per-field, not per-row. No data loss.
- **Append-only log** — Simple, auditable replication primitive.
- **Modular & headless** — Core logic has zero dependencies. Bring your own database.
- **Framework agnostic** — Works with any UI framework or backend.


## Documentation

Full documentation available [here](https://jan-eckerlein.github.io/converge/docs/). or self host with `pnpm dev`

## Install

```bash
pnpm add @converge/core @converge/server @converge/db-sqlite
```

## Quick Example

```typescript
import { SqliteDb } from '@converge/db-sqlite';
import { createMaterializerConfig } from '@converge/materialize-db';

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
| `@converge/core` | HLC, Change types, pure merge logic |
| `@converge/server` | Db interface, append/pull contracts |
| `@converge/client` | Store interface, sync orchestration |

**Database Adapters**:

| Package | Description |
|---------|-------------|
| `@converge/db-sqlite` | SQLite via better-sqlite3 |
| `@converge/db-turso` | Turso (libSQL) with batching |
| `@converge/db-drizzle` | Any Drizzle-supported database |
| `@converge/db-memory` | In-memory (for testing) |

**Materializers**:

| Package | Description |
|---------|-------------|
| `@converge/materialize-db` | SQL-based state projection |
| `@converge/materialize-drizzle` | Drizzle ORM state projection |

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm dev        # Start docs site
```

## License

MIT