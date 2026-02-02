# @rippledb/remote-trpc

tRPC client for RippleDB sync.

📚 **Documentation:**
[rippledb.dev/docs/reference/remote-trpc](https://rippledb.dev/docs/reference/remote-trpc)

## Installation

```bash
npm install @rippledb/remote-trpc @rippledb/client @rippledb/core @trpc/client
```

## Usage

```typescript
import { createReplicator } from "@rippledb/client";
import { createTrpcRemote } from "@rippledb/remote-trpc";
import { trpc } from "./trpc";

const remote = createTrpcRemote({
  pull: trpc.ripple.pull.query,
  append: trpc.ripple.append.mutate,
});

const replicator = createReplicator({
  stream: "user-123",
  store,
  remote,
});

await replicator.sync();
```

## Features

- Type-safe with tRPC
- Works with any tRPC client setup
- Easy testing with direct caller

## License

MIT
