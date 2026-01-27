---
"@rippledb/bind-tanstack": minor
---

Add @rippledb/bind-tanstack — TanStack Query cache invalidation binding

- `defineListRegistry()` builder for mapping query keys to entity dependencies
- `wireTanstackInvalidation()` to wire DbEvents to queryClient.invalidateQueries()
- Debounce support (default 50ms) to coalesce rapid-fire events
- Works with any TanStack Query adapter (React, Vue, Solid, Svelte)
