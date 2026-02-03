# @rippledb/core

## 0.3.0

### Minor Changes

- [#34](https://github.com/eckerlein/rippledb/pull/34)
  [`65520ef`](https://github.com/eckerlein/rippledb/commit/65520ef17bf55ecfb0a79da4212976d68b74f15b)
  Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - Refactor
  materializer adapters to stateless API
  - MaterializerFactory now receives `{ db, schema }` and returns
    MaterializerAdapter directly
  - Adapters and executors are stateless (db passed per call instead of bound at
    creation)
  - Add schema-driven helpers: `createMaterializer`, `createSyncMaterializer`,
    `createDrizzleMaterializer`, `createDrizzleSyncMaterializer`
  - Add `MaterializerDb` interface in `@rippledb/core` for database contract
  - Adapters are cached in DB constructors for performance
  - Update all DB adapters to use new factory pattern

  BREAKING CHANGE: MaterializerFactory signature changed. Materializer adapters
  now receive `db` as first parameter in all methods.

### Patch Changes

- [#44](https://github.com/eckerlein/rippledb/pull/44)
  [`fdfabe9`](https://github.com/eckerlein/rippledb/commit/fdfabe9365356ed777d0407a0b92a4c75037c3f1)
  Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - Optimize
  TypeScript type checking performance
  - Restructure `FieldDescriptor` union for faster type narrowing
  - Simplify `InferField` type to reduce conditional depth
  - Add helper types to `zod` package for better type inference
  - Reduce TypeScript compilation time across the monorepo

  These changes are internal type optimizations that maintain full backwards
  compatibility.

## 0.2.0

### Minor Changes

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

## 0.1.1

### Patch Changes

- [`02a90c8`](https://github.com/eckerlein/rippledb/commit/02a90c82c70d09ee89f855d7142463263b71fc11)
  Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - docs: add README
  files to all packages
