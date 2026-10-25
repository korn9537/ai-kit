# C# and .NET conventions

Reader: agents writing or reviewing C#. Adds to `general.md`.

1. **Build** — `TreatWarningsAsErrors`, `Nullable` enabled, `EnforceCodeStyleInBuild`. NuGet vulnerability audit
   on; an advisory is suppressed one GHSA at a time, with its reason.
2. **Namespace = folder** — IDE0130 at warning. A namespace never shares a name with a type inside it (plural
   folder, singular type).
3. **Clean Architecture** — dependencies point inward (Domain → Application → Infrastructure → Api). Domain
   entities have private setters, validate in the constructor, and keep a private parameterless constructor for
   EF.
4. **Minimal APIs** — `MapGroup`, `TypedResults`, `.WithName`, and `.ProducesProblem` per error status.
5. **Errors** — Application throws NotFound, Conflict and Validation exceptions; one global exception handler maps
   them to problem details. A handler checks for a duplicate and throws Conflict with a readable message; the
   unique or FK violation → 409 mapping is only a safety net and never leaks the database message.
6. **JSON** — `JsonNamingPolicy.SnakeCaseLower` plus `JsonStringEnumConverter(SnakeCaseLower)`. Dictionary keys
   skip the converter, so an enum-valued key is a snake_case string. An enum query parameter is `string?` parsed by
   a helper that returns 400 (query binding is PascalCase), never a raw `enum?`.
7. **EF Core** — one `DbContext` per database. `UseSnakeCaseNamingConvention`; a property with a digit next to
   letters sets `HasColumnName` (EF and SnakeCaseLower split digits differently). Enums go through one string
   converter. A collection property has a structural `ValueComparer`. Prefer a LINQ join; a second read is one
   batched read keyed by the page, never one per row.
8. **Migrations and seeding** — migrations hold schema only; seeding is a separate idempotent command, never
   `HasData` and never on boot.
9. **Audit and transactions** — audit columns (created/updated at/by) are stamped by a `SaveChangesInterceptor`,
   never by handlers; one request = one transaction.
10. **Tests** — SQL-level behaviour is tested against a real PostgreSQL (Testcontainers), never a stub.
11. **Large files** — rule: `general.md` item 12. The split goes into `partial class` files named
    `<Class>.<Group>.cs`.
