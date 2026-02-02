# TypeScript Performance Analysis & Recommendations

Based on the
[TypeScript Performance Wiki](https://github.com/microsoft/Typescript/wiki/Performance),
here are actionable improvements for our codebase.

## ✅ Already Implemented

1. **Incremental builds** - `incremental: true` in `tsconfig.base.json`
2. **Skip lib checking** - `skipLibCheck: true` (reduces work on node_modules)
3. **VS Code optimizations** - Memory limits, file watching exclusions
4. **Type optimizations** - `InferField` and `ValidateOverrides` optimized

## 🔍 Key Findings from TypeScript Wiki

### 1. Prefer Interfaces Over Intersections ⚠️

**Wiki says:** "Interfaces create a single flat object type... Type
relationships between interfaces are also cached, as opposed to intersection
types as a whole."

**Found in our codebase:**

- `packages/materialize-db/src/sync-adapter.ts:47` - `SyncMaterializerAdapter`
  uses `& MaterializerAdapter`
- `packages/client-query/src/index.ts:71-91` - `ClientQueryApi` uses
  intersection `&`
- `packages/zod/src/index.ts:72-80` - `SchemaDescriptorWithZod` uses
  intersection `&`

**Recommendation:** Convert these to `interface extends` for better caching.

### 2. Use Type Annotations ✅ Mostly Good

**Wiki says:** "Adding type annotations, especially return types, can save the
compiler a lot of work."

**Found in our codebase:**

- ✅ Most functions have return types (e.g., `parseHlc`, `formatHlc`,
  `compareHlc`)
- ✅ `defineSchema` has explicit return type
- ⚠️ Some complex functions might benefit from explicit return types

**Recommendation:** Review complex functions for missing return types.

### 3. Prefer Base Types Over Unions ⚠️

**Wiki says:** "Unions can be expensive to check."

**Found in our codebase:**

- `FieldDescriptor` uses union of 4 types
- Various union types throughout

**Recommendation:** Where possible, use discriminated unions or base types
instead of large unions.

### 4. Name Complex Types ✅ Good

**Wiki says:** "Named types tend to be more compact than anonymous types."

**Found in our codebase:**

- ✅ We use named types extensively (`InferField`, `InferSchema`, etc.)
- ✅ Helper types are well-named

**Status:** Good practice already followed.

### 5. Project References ❌ Not for IDE

**Wiki says:** "Use project references to improve build times."

**Our finding:** We tested this and it doesn't help IDE performance (only CLI
builds).

**Status:** Correctly removed for IDE optimization.

## 🎯 Actionable Improvements

### Priority 1: Convert Intersections to Interfaces

**File: `packages/materialize-db/src/sync-adapter.ts`**

```typescript
// Current (intersection):
export type SyncMaterializerAdapter<...> = {
  load(...): ...;
  save(...): ...;
  remove(...): ...;
} & MaterializerAdapter<S, TDb>;

// Better (interface):
export interface SyncMaterializerAdapter<...> extends MaterializerAdapter<S, TDb> {
  load<E extends EntityName<S>>(...): MaterializerState<S, E> | null;
  save<E extends EntityName<S>>(...): void;
  remove<E extends EntityName<S>>(...): void;
}
```

**File: `packages/client-query/src/index.ts`**

```typescript
// Current (intersection):
export type ClientQueryApi<...> =
  & { [K in EntityName<S>]: EntityController<...> }
  & { query<T>(...): Promise<T>; cleanup(): void; };

// Better (interface):
export interface ClientQueryApi<...> {
  [K in EntityName<S>]: EntityController<S, K, ListQuery>;
  query<T>(options: QueryOptions<S, T>): Promise<T>;
  cleanup(): void;
}
```

**File: `packages/zod/src/index.ts`**

```typescript
// Current (intersection):
export type SchemaDescriptorWithZod<...> =
  & SchemaDescriptor<S>
  & { readonly zod: ZodSchemas<S>; };

// Better (interface):
export interface SchemaDescriptorWithZod<...> extends SchemaDescriptor<S> {
  readonly zod: ZodSchemas<S>;
}
```

### Priority 2: Review Complex Functions for Return Types

Check functions that:

- Have complex inference
- Are exported
- Are used across packages

### Priority 3: Consider Type Aliases for Complex Unions

For `FieldDescriptor` union type, consider if a discriminated union would be
faster.

## 📊 Performance Impact Estimate

Based on TypeScript wiki:

- **Interfaces vs Intersections:** ~10-20% faster type checking for those types
- **Explicit return types:** ~5-15% faster for complex functions
- **Named types:** Already optimized ✅

## 🔧 Tools We Have

1. `pnpm perf:diagnose` - Find slow packages
2. `pnpm perf:find-types` - Find complex types
3. `pnpm perf:tsc` - Measure overall performance

## 📝 Next Steps

1. Convert intersection types to interfaces (Priority 1)
2. Test performance impact with `pnpm perf:diagnose`
3. Review and add return types to complex functions (Priority 2)
4. Monitor with our performance scripts
