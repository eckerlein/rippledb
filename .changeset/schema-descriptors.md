---
"@rippledb/core": minor
"@rippledb/zod": minor
---

feat(core): Runtime schema descriptors with field type metadata

- Add field descriptor types (`StringField`, `NumberField`, `BooleanField`, `EnumField`)
- Add `s.string()`, `s.number()`, `s.boolean()`, `s.enum()` builder functions with `.optional()` modifier
- Add `InferSchema<D>` type helper for deriving TypeScript types from field descriptors
- Add `SchemaDescriptor` runtime API with entity discovery, field metadata, and extensibility

feat(zod): Auto-generated Zod schemas from field descriptors

- Add `withZod()` wrapper that auto-generates Zod schemas from schema descriptors
- Support typed overrides for custom field validation refinements
