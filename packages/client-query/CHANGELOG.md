# @rippledb/client-query

## 0.1.1

### Patch Changes

- [#18](https://github.com/eckerlein/rippledb/pull/18)
  [`14fb351`](https://github.com/eckerlein/rippledb/commit/14fb35170e1a380e4c039c59987d96f0938fca73)
  Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - feat(core):
  Runtime schema descriptors with field type metadata
  - Add field descriptor types (`StringField`, `NumberField`, `BooleanField`,
    `EnumField`)
  - Add `s.string()`, `s.number()`, `s.boolean()`, `s.enum()` builder functions
    with `.optional()` modifier
  - Add `InferSchema<D>` type helper for deriving TypeScript types from field
    descriptors
  - Add `SchemaDescriptor` runtime API with entity discovery, field metadata,
    and extensibility

  feat(zod): Auto-generated Zod schemas from field descriptors
  - Add `withZod()` wrapper that auto-generates Zod schemas from schema
    descriptors
  - Support typed overrides for custom field validation refinements

  fix(client-query): Update to use new schema descriptor types
  - Use `InferSchema` and `DescriptorSchema` for proper type inference
  - Update `createClientQueryApi` to derive schema types from descriptors

- Updated dependencies
  [[`14fb351`](https://github.com/eckerlein/rippledb/commit/14fb35170e1a380e4c039c59987d96f0938fca73)]:
  - @rippledb/core@0.2.0
  - @rippledb/bind-tanstack-query@0.1.2
  - @rippledb/client@0.1.2
  - @rippledb/client-controllers@0.1.1
