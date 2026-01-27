# @rippledb/remote-http

HTTP client for RippleDB sync.

📚 **Documentation:** [rippledb.dev/docs/reference/remote-http](https://rippledb.dev/docs/reference/remote-http)

## Installation

```bash
npm install @rippledb/remote-http @rippledb/client @rippledb/core
```

## Usage

```typescript
import { createHttpRemote } from '@rippledb/remote-http';
import { createReplicator } from '@rippledb/client';

const remote = createHttpRemote({
  baseUrl: 'https://api.example.com/ripple',
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

const replicator = createReplicator({
  stream: 'user-123',
  store,
  remote,
});

await replicator.sync();
```

## Features

- Simple HTTP POST to `/pull` and `/append`
- Custom headers support
- Custom fetch implementation (for SSR, testing, etc.)

## License

MIT
