# @rippledb/zod

Zod schemas for runtime validation of RippleDB types.

📚 **Documentation:**
[rippledb.dev/docs/reference/zod](https://rippledb.dev/docs/reference/zod)

## Installation

```bash
npm install @rippledb/zod zod
```

## Usage

```typescript
import {
  appendRequestSchema,
  changeSchema,
  createChangeSchema,
  pullRequestSchema,
} from "@rippledb/zod";
import { z } from "zod";

// Validate a pull request
const result = pullRequestSchema.safeParse({
  stream: "my-stream",
  cursor: null,
  limit: 100,
});

if (result.success) {
  console.log("Valid:", result.data);
} else {
  console.error("Invalid:", result.error);
}

// Create a typed change schema for your entities
const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

const todoChangeSchema = createChangeSchema(todoSchema);
```

## Available Schemas

| Schema                       | Description                        |
| ---------------------------- | ---------------------------------- |
| `hlcSchema`                  | HLC timestamp format validation    |
| `changeKindSchema`           | Change kind ('upsert' \| 'delete') |
| `changeSchema`               | Generic change object              |
| `createChangeSchema(schema)` | Create typed change schema         |
| `pullRequestSchema`          | Pull request validation            |
| `pullResponseSchema`         | Pull response validation           |
| `appendRequestSchema`        | Append request validation          |
| `appendResultSchema`         | Append result validation           |

## License

MIT
