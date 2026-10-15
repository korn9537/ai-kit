# SQL (PostgreSQL) conventions

Reader: agents writing or reviewing schema, migrations and queries. Adds to `general.md`; the repo's
`ai/kit/review-checklist.md` wins on a conflict and is where a repo writes an exception, with its reason.

1. **Time** — `timestamptz`, values in UTC.
2. **Append-only tables** — a ledger or history table has no UPDATE or DELETE path; a correction is a new row.
3. **Names** — tables lowercase, plural, snake_case.
4. **Enums** — stored as strings, never integers.
5. **Foreign keys** — real foreign keys, default restrict; cascade only for rows meaningless without the parent.
6. **Unique names** — a unique name gets a case-insensitive unique index (the column stays plain), and values are
   trimmed on save.
7. **Indexes on large tables** — created or dropped `CONCURRENTLY IF [NOT] EXISTS` in a migration of its own,
   outside a transaction, one statement per call. A failed build leaves an INVALID index; drop it before rerunning.
8. **NOT NULL on an existing column** — three steps: add it nullable, backfill, then alter to NOT NULL. Never a
   `NOT NULL DEFAULT` that overwrites existing data.
9. **Imported rows** — an imported row carries its source and its external id, unique per source (and per owner
   where rows are owned) where the id is set, so a re-import updates instead of duplicating.
10. **DDL** — only through migrations.
