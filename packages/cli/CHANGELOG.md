# @rippledb/cli

## 0.1.0

### Minor Changes

- [#22](https://github.com/eckerlein/rippledb/pull/22) [`0b820d0`](https://github.com/eckerlein/rippledb/commit/0b820d005e53d25ba82ef7f1d0796e1e887d9a04) Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - Add new `@rippledb/cli` package with Drizzle schema codegen
  - `npx rippledb generate` command for schema generation
  - `defineConfig()` helper for type-safe `ripple.config.ts`
  - Drizzle table introspection with automatic type mapping
  - Uses `jiti` for TypeScript config file support

### Patch Changes

- Updated dependencies [[`14fb351`](https://github.com/eckerlein/rippledb/commit/14fb35170e1a380e4c039c59987d96f0938fca73)]:
  - @rippledb/core@0.2.0
