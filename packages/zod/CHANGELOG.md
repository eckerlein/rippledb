# @rippledb/zod

## 0.2.1

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

- Updated dependencies
  [[`fdfabe9`](https://github.com/eckerlein/rippledb/commit/fdfabe9365356ed777d0407a0b92a4c75037c3f1),
  [`65520ef`](https://github.com/eckerlein/rippledb/commit/65520ef17bf55ecfb0a79da4212976d68b74f15b)]:
  - @rippledb/core@0.3.0

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

- [`ae30641`](https://github.com/eckerlein/rippledb/commit/ae3064169e1f353e75ad79a54af27c75a9f1873f)
  Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - Add strict type
  validation for `withZod()` overrides
  - Added `ValidateOverrides` type helper that ensures override objects only
    contain valid entity and field keys
  - Added type tests using `.test-d.ts` pattern with `@ts-expect-error`
    directives
  - Updated documentation with inline and typed external override patterns
  - Empty override objects are now correctly handled

### Patch Changes

- Updated dependencies
  [[`14fb351`](https://github.com/eckerlein/rippledb/commit/14fb35170e1a380e4c039c59987d96f0938fca73)]:
  - @rippledb/core@0.2.0

## 0.1.4

### Patch Changes

- Updated dependencies
  [[`02a90c8`](https://github.com/eckerlein/rippledb/commit/02a90c82c70d09ee89f855d7142463263b71fc11)]:
  - @rippledb/core@0.1.1

## 0.1.3

### Patch Changes

- [`34dd0a8`](https://github.com/eckerlein/rippledb/commit/34dd0a8fefa48a401069b5acfe0645d81ae3c11d)
  Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - Add documentation
  link and fix license in README

- [`d09a63f`](https://github.com/eckerlein/rippledb/commit/d09a63f009d00eeb6cd3dc20b442a92117aa4856)
  Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - Add MIT license
  to package.json

## 0.1.2

### Patch Changes

- [`cca791e`](https://github.com/eckerlein/rippledb/commit/cca791e0bfe049c208f8ab6fc01450200d17ef7c)
  Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - Add README
  documentation and npm keywords for discoverability

## 0.1.1

### Patch Changes

- Manual republish after npm registry sync issues

## 0.1.0

### Minor Changes

- [`e314c89`](https://github.com/eckerlein/rippledb/commit/e314c89f67b83def824e8852492ed9d9b22ebd42)
  Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - Add @rippledb/zod
  utility package
