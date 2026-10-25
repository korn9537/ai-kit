# TypeScript and React conventions

Reader: agents writing or reviewing TypeScript and React. Adds to `general.md`.

1. **API types** — never hand-written: the client is generated from the OpenAPI spec, regenerated and committed
   in the same change as the API.
2. **State** — server state lives in TanStack Query, UI state in a client store; server data is never copied into
   the store. Every value a `queryFn` reads is in its `queryKey`, or the query serves another input's cached data
   until it expires: `queryKey: ['orders', customerId]` for `queryFn: () => getOrders(customerId)`.
3. **Invalidation** — a mutation declares what it invalidates (mutation `meta` read by a global `MutationCache`),
   not a router refresh.
4. **Forms** — react-hook-form + zod, one schema per editable slice. A dialog validates only the fields it renders,
   and a PUT carries the slices the dialog hides. An edit form mounts seeded through `defaultValues` and resets on
   open, not `useEffect` + `reset`.
5. **Pickers** — a picker holds the row id; the label is display only. Never find an id by matching a label.
6. **Data states** — render loading → error → empty → data, loading as a skeleton; "nothing yet" differs from
   "filtered to nothing".
7. **Filters** — filter state lives in the URL; a filter change resets to page 1; search is debounced.
8. **Query-string input** — fields seeded from the query string are whitelisted. A return-to path must be a
   same-origin relative path; reject `//host` and absolute URLs.
9. **Dates** — no `toISOString()` for day keys; pin `timeZone` (and `calendar`) on every `Intl` format.
10. **Next.js** — a route file exports only names Next knows; `page.tsx` holds one component, its default export.
11. **Large files** — rule: `general.md` item 12. The split goes into a sibling folder; the original file keeps its
    path and re-exports every name it exported, so no importer changes. No index file in that folder. In a NestJS repo,
    a provider class: `nestjs.md` item 1 replaces this item.
12. **Lint baseline** — the root ESLint config extends `js.configs.recommended` beside `typescript-eslint`
    `recommended` (which leaves `no-fallthrough` and `no-unreachable` off); server code adds
    `@typescript-eslint/no-floating-promises` with typed linting (`parserOptions.projectService: true`); a repo with
    TanStack Query adds `@tanstack/eslint-plugin-query` with `@tanstack/query/exhaustive-deps` as an error.
