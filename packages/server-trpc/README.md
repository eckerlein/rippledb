# @rippledb/server-trpc

tRPC router for RippleDB sync endpoints.

📚 **Documentation:**
[rippledb.dev/docs/reference/server-trpc](https://rippledb.dev/docs/reference/server-trpc)

## Installation

```bash
npm install @rippledb/server-trpc @rippledb/server @rippledb/core @trpc/server
```

## Usage

```typescript
import { createRippleTrpcRouter } from "@rippledb/server-trpc";
import { initTRPC } from "@trpc/server";

const rippleRouter = createRippleTrpcRouter({ db });

const t = initTRPC.create();
export const appRouter = t.router({
  ripple: rippleRouter,
});

// Exposes:
// - ripple.pull (query)
// - ripple.append (mutation)
```

## Features

- Creates `pull` and `append` procedures
- Works with any RippleDB `Db` adapter
- Type-safe with tRPC

## License

MIT
