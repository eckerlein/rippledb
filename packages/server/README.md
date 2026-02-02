# @rippledb/server

Server-side contracts and interfaces for RippleDB persistence.

📚 **Documentation:**
[rippledb.dev/docs/reference/server](https://rippledb.dev/docs/reference/server)

## Installation

```bash
npm install @rippledb/server @rippledb/core
```

## Usage

```typescript
import type { AppendRequest, Db, PullRequest } from "@rippledb/server";

// Implement the Db interface for your database
class MyDb implements Db<MySchema> {
  async append(req: AppendRequest<MySchema>) {
    // Store changes in your database
    return { accepted: req.changes.length };
  }

  async pull(req: PullRequest) {
    // Fetch changes from your database
    return { changes: [], nextCursor: req.cursor };
  }
}
```

## Exports

| Export          | Description                        |
| --------------- | ---------------------------------- |
| `Db`            | Interface for database adapters    |
| `AppendRequest` | Request type for appending changes |
| `AppendResult`  | Result type for append operations  |
| `PullRequest`   | Request type for pulling changes   |
| `PullResponse`  | Response type for pull operations  |
| `Cursor`        | Cursor type for pagination         |

## License

MIT
