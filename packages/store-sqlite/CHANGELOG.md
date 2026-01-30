# Changelog

## 0.1.2

### Patch Changes

- Updated dependencies [[`14fb351`](https://github.com/eckerlein/rippledb/commit/14fb35170e1a380e4c039c59987d96f0938fca73)]:
  - @rippledb/core@0.2.0
  - @rippledb/client@0.1.2

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2025-01-XX

### Added

- Initial release of `@rippledb/store-sqlite`
- `SqliteStore` class implementing the `Store` interface
- Support for persistent SQLite storage
- Event subscription via `onEvent`
- Efficient bulk reads with `getRows`
- SQL query support with `listRows`
- Transactional writes with `applyChanges`
