# @rippledb/scripts-perf

TypeScript performance diagnostics and checking tools for the RippleDB monorepo.

## Why a separate package?

This package is isolated from the root `scripts/` folder to properly handle
Ink's dependencies. Ink depends on `yoga-layout` which uses **top-level await**,
which requires:

1. **ESM module system** (`"type": "module"`)
2. **ES2022 target** (supports top-level await)
3. **Proper compilation** (not processed by `tsx` which uses esbuild that
   doesn't support top-level await in CJS mode)

By compiling this package with `tsc` and running with `node`, we avoid `tsx`'s
dependency processing issues.

## Usage

```bash
# Build the package
pnpm --filter @rippledb/scripts-perf build

# Run diagnostics (from root)
pnpm perf:diagnose

# Run performance check (from root)
pnpm perf:check
```

## Development

For development, you can use `tsx` directly (though it may have issues with
Ink):

```bash
pnpm --filter @rippledb/scripts-perf dev
```
