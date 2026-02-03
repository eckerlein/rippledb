# @rippledb/db-drizzle

## 0.2.0

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

- Updated dependencies
  [[`fdfabe9`](https://github.com/eckerlein/rippledb/commit/fdfabe9365356ed777d0407a0b92a4c75037c3f1),
  [`65520ef`](https://github.com/eckerlein/rippledb/commit/65520ef17bf55ecfb0a79da4212976d68b74f15b)]:
  - @rippledb/core@0.3.0
  - @rippledb/materialize-core@0.2.0
  - @rippledb/server@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies
  [[`14fb351`](https://github.com/eckerlein/rippledb/commit/14fb35170e1a380e4c039c59987d96f0938fca73)]:
  - @rippledb/core@0.2.0
  - @rippledb/materialize-core@0.1.2
  - @rippledb/server@0.1.2

## 0.1.1

### Patch Changes

- [`02a90c8`](https://github.com/eckerlein/rippledb/commit/02a90c82c70d09ee89f855d7142463263b71fc11)
  Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - docs: add README
  files to all packages

- Updated dependencies
  [[`02a90c8`](https://github.com/eckerlein/rippledb/commit/02a90c82c70d09ee89f855d7142463263b71fc11)]:
  - @rippledb/core@0.1.1
  - @rippledb/server@0.1.1
  - @rippledb/materialize-core@0.1.1
