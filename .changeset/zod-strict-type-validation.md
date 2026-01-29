---
"@rippledb/zod": minor
---

Add strict type validation for `withZod()` overrides

- Added `ValidateOverrides` type helper that ensures override objects only contain valid entity and field keys
- Added type tests using `.test-d.ts` pattern with `@ts-expect-error` directives
- Updated documentation with inline and typed external override patterns
- Empty override objects are now correctly handled
