---
"@rippledb/core": patch
"@rippledb/client-query": patch
"@rippledb/materialize-db": patch
"@rippledb/zod": patch
---

Optimize TypeScript type checking performance

- Restructure `FieldDescriptor` union for faster type narrowing
- Simplify `InferField` type to reduce conditional depth
- Add helper types to `zod` package for better type inference
- Reduce TypeScript compilation time across the monorepo

These changes are internal type optimizations that maintain full backwards
compatibility.
