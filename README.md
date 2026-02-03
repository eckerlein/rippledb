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
pnpm add @rippledb/core @rippledb/db-sqlite @rippledb/materialize-db
```

## Quick Example

```typescript
import { defineSchema, makeUpsert, s } from "@rippledb/core";
import { createHlcState, tickHlc } from "@rippledb/core";
import { SqliteDb } from "@rippledb/db-sqlite";
import { createSyncMaterializer } from "@rippledb/materialize-db";

const schema = defineSchema({
  todos: { id: s.string(), title: s.string(), done: s.boolean() },
});

const db = new SqliteDb({
  filename: "./data.db",
  schema,
  materializer: ({ db, schema }) =>
    createSyncMaterializer({
      schema,
      db,
      dialect: "sqlite",
      tableMap: { todos: "todos" },
      fieldMap: { todos: { id: "id", title: "title", done: "done" } },
    }),
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

**Database Adapters** (server-side persistence):

| Package                | Best For                           |
| ---------------------- | ---------------------------------- |
| `@rippledb/db-sqlite`  | Local servers, Electron, tests     |
| `@rippledb/db-turso`   | Edge deployments, serverless       |
| `@rippledb/db-drizzle` | Existing Drizzle projects (any DB) |
| `@rippledb/db-memory`  | Unit tests, prototyping            |

**Materializers** (project changes → queryable tables):

| Package                         | Best For                     |
| ------------------------------- | ---------------------------- |
| `@rippledb/materialize-db`      | Raw SQL projects             |
| `@rippledb/materialize-drizzle` | Drizzle projects (type-safe) |

**Stores** (client-side local truth):

| Package                  | Best For                |
| ------------------------ | ----------------------- |
| `@rippledb/store-memory` | Unit tests, prototyping |
| `@rippledb/store-sqlite` | Production client apps  |

**Bindings** (UI cache invalidation):

| Package                         | Framework                 |
| ------------------------------- | ------------------------- |
| `@rippledb/bind-tanstack-query` | React, Vue, Solid, Svelte |

**Client Extensions**:

| Package                        | Description                     |
| ------------------------------ | ------------------------------- |
| `@rippledb/client-query`       | Reactive queries with selectors |
| `@rippledb/client-controllers` | Client-side write helpers       |

**Remote & Server**:

| Package                 | Description             |
| ----------------------- | ----------------------- |
| `@rippledb/remote-http` | HTTP remote sync client |
| `@rippledb/remote-trpc` | tRPC remote sync client |
| `@rippledb/server-trpc` | tRPC server adapter     |

**Utilities**:

| Package         | Description               |
| --------------- | ------------------------- |
| `@rippledb/zod` | Zod schema <-> RippleDB   |
| `@rippledb/cli` | Code generation & tooling |

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

For real-time formatting in VS Code, install dprint globally:

```bash
# Using homebrew (recommended for macOS)
brew install dprint

# OR using the official installer
curl -fsSL https://dprint.dev/install.sh | sh
```

Then:

1. Install the Dprint extension (`dprint.dprint`) from the VS Code marketplace
2. Reload your editor (`Cmd+Shift+P` → "Reload Window")

**Alternative: Use Local dprint (No Global Install)**

The workspace settings already point to the local `node_modules` dprint. To use
it instead of a global install, just install the extension and click "Allow"
when prompted. This approach requires clicking through a security prompt and can
be harder to debug if something goes wrong.

### Available Scripts

```bash
pnpm test          # Run tests
pnpm test:watch    # Run tests in watch mode
pnpm dev           # Start docs site
pnpm lint          # Run linter
```

## License

MIT
