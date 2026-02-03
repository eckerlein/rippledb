# RippleDB

A **local-first sync engine** with field-level conflict resolution.

RippleDB treats local storage as the source of truth. Changes replicate via an
append-only log, and conflicts resolve deterministically at the field level
using hybrid logical clocks (HLC).

## Features

- **Local-first** — Your app works offline. Local writes are instant.
- **Field-level LWW** — Conflicts resolve per-field, not per-row. No data loss.
- **Append-only log** — Simple, auditable replication primitive.
- **Modular & headless** — Core logic has zero dependencies. Bring your own
  database.
- **Framework agnostic** — Works with any UI framework or backend.

## Documentation

📚 **Full documentation:** [rippledb.dev/docs](https://rippledb.dev/docs/)

To run locally: `pnpm dev` (from `apps/docs`)

## Install

```bash
pnpm add @rippledb/core @rippledb/server @rippledb/db-sqlite
```

## Quick Example

```typescript
import { makeUpsert } from "@rippledb/core";
import { createHlcState, tickHlc } from "@rippledb/core";
import { SqliteDb } from "@rippledb/db-sqlite";
import { createSyncSqlExecutor } from "@rippledb/materialize-db";

const db = new SqliteDb({
  filename: "./data.db",
  materializer: ({ db }) => {
    const sqlConfig = {
      dialect: "sqlite",
      tableMap: { todos: "todos" },
      fieldMap: { todos: { id: "id", title: "title", done: "done" } },
    } as const;
    return {
      ...sqlConfig,
      executor: createSyncSqlExecutor(db, sqlConfig),
    };
  },
});

// Append a change
const hlc = tickHlc(createHlcState("node-1"), Date.now());
await db.append({
  stream: "my-stream",
  changes: [
    makeUpsert({
      stream: "my-stream",
      entity: "todos",
      entityId: "todo-1",
      patch: { id: "todo-1", title: "Buy milk", done: false },
      hlc,
    }),
  ],
});

// Pull changes
const { changes, nextCursor } = await db.pull({
  stream: "my-stream",
  cursor: null,
});
```

## Packages

**Core** (interfaces & pure logic):

| Package            | Description                         |
| ------------------ | ----------------------------------- |
| `@rippledb/core`   | HLC, Change types, pure merge logic |
| `@rippledb/server` | Db interface, append/pull contracts |
| `@rippledb/client` | Store interface, sync orchestration |

**Database Adapters**:

| Package                | Description                    |
| ---------------------- | ------------------------------ |
| `@rippledb/db-sqlite`  | SQLite via better-sqlite3      |
| `@rippledb/db-turso`   | Turso (libSQL) with batching   |
| `@rippledb/db-drizzle` | Any Drizzle-supported database |
| `@rippledb/db-memory`  | In-memory (for testing)        |

**Materializers**:

| Package                         | Description                  |
| ------------------------------- | ---------------------------- |
| `@rippledb/materialize-db`      | SQL-based state projection   |
| `@rippledb/materialize-drizzle` | Drizzle ORM state projection |

## Development

### Setup

```bash
pnpm install
pnpm build
```

### Code Formatting

This project uses [dprint](https://dprint.dev/) for code formatting.

#### CLI

```bash
pnpm format        # Format all files
pnpm format:check  # Check formatting without changing files
```

#### Git Commit Hook (Automatic)

Code is automatically formatted on commit via `husky` and `lint-staged`. No
manual action required.

#### VS Code Extension (Optional)

For real-time formatting in VS Code, install the Dprint extension
(`dprint.dprint`) AND dprint globally:

```bash
# Using homebrew (recommended for macOS)
brew install dprint

# OR using the official installer
curl -fsSL https://dprint.dev/install.sh | sh

# OR using cargo (if you have Rust installed)
cargo install dprint
```

Verify installation and reload VS Code:

```bash
which dprint
dprint --version
```

Then reload your editor (`Cmd+Shift+P` → "Reload Window") to enable the Dprint
extension.

### Available Scripts

```bash
pnpm test          # Run tests
pnpm test:watch    # Run tests in watch mode
pnpm dev           # Start docs site
pnpm lint          # Run linter
```

## License

MIT
