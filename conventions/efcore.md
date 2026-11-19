# EF Core conventions

Reader: agents writing or reviewing EF Core code. Adds to `general.md`, `csharp.md` (item 7) and `sql.md`.

1. **Soft delete without a global filter** — a soft-deleted entity that other records join or `Include` to print its
   name is hidden by an opt-in read (one shared extension, such as `Listed()` or `NotDeleted()`) called only in list
   and picker reads, never by `HasQueryFilter`. A global filter also drops the row from every join and `Include`, so
   old records lose the name they print; through a required navigation it drops the records that point at it too. Name
   readers, seeders and import or sync matchers read the table unfiltered; a seeder that filters re-inserts a seeded
   row someone deleted. Wrong: `builder.HasQueryFilter(x => !x.IsDeleted);`. Right: `db.Set<Region>().NotDeleted()` in
   the region list endpoint; the order view joins `Region` unfiltered. A repo's `ai/kit/pre-commit.sh` can fail on a
   `HasQueryFilter` over the soft-delete flag; a filter of another kind (a tenant) is not this rule. Source: EF Core
   docs, Global Query Filters.
2. **No delete rewritten into a flag** — a `SaveChanges` interceptor never turns a `Remove` into `IsDeleted = true`
   while a Cascade foreign key points at the entity: by then EF has already marked the loaded dependents Deleted (the
   default immediate cascade timing), so they are really deleted while the parent is only flagged, and the loss is
   silent. Soft delete is an update the handler makes on purpose. Source: EF Core docs, Cascade Delete.
3. **Flag shape** — `is_deleted boolean NOT NULL DEFAULT false` plus `deleted_at`, and the audit stamps of any
   update (`csharp.md` item 9). A unique name becomes a partial index (`WHERE NOT is_deleted`, joined to any filter
   it already has), so a deleted name can be used again; a code that other code or imports match on stays unique
   over all rows. The audit trail records the flip as a `deleted` action, not `updated`.
