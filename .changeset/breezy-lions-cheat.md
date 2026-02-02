---
"@rippledb/core": minor
"@rippledb/materialize-core": minor
"@rippledb/materialize-db": minor
"@rippledb/materialize-drizzle": minor
"@rippledb/db-sqlite": minor
"@rippledb/db-turso": minor
"@rippledb/db-drizzle": minor
---

Refactor materializer adapters to stateless API

- MaterializerFactory now receives `{ db, schema }` and returns MaterializerAdapter directly
- Adapters and executors are stateless (db passed per call instead of bound at creation)
- Add schema-driven helpers: `createMaterializer`, `createSyncMaterializer`, `createDrizzleMaterializer`, `createDrizzleSyncMaterializer`
- Add `MaterializerDb` interface in `@rippledb/core` for database contract
- Adapters are cached in DB constructors for performance
- Update all DB adapters to use new factory pattern

BREAKING CHANGE: MaterializerFactory signature changed. Materializer adapters now receive `db` as first parameter in all methods.
