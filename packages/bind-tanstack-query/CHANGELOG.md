# @rippledb/bind-tanstack-query

## 0.1.2

### Patch Changes

- Updated dependencies
  [[`14fb351`](https://github.com/eckerlein/rippledb/commit/14fb35170e1a380e4c039c59987d96f0938fca73)]:
  - @rippledb/core@0.2.0
  - @rippledb/client@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies
  [[`02a90c8`](https://github.com/eckerlein/rippledb/commit/02a90c82c70d09ee89f855d7142463263b71fc11)]:
  - @rippledb/core@0.1.1
  - @rippledb/client@0.1.1

## 0.1.0

### Minor Changes

- [`307e39a`](https://github.com/eckerlein/rippledb/commit/307e39aea101f97ef9d888baabfb50dbbff0a412)
  Thanks [@Jan-Eckerlein](https://github.com/Jan-Eckerlein)! - Add
  @rippledb/bind-tanstack-query — TanStack Query cache invalidation binding
  - `defineListRegistry()` builder for mapping query keys to entity dependencies
  - `wireTanstackInvalidation()` to wire DbEvents to
    queryClient.invalidateQueries()
  - Debounce support (default 50ms) to coalesce rapid-fire events
  - Works with any TanStack Query adapter (React, Vue, Solid, Svelte)
