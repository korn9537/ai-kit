# TypeORM conventions

Reader: agents writing or reviewing TypeORM code. Adds to `general.md`, `typescript.md` and `sql.md`.

1. **Where values** — a `find*`, `exists*` or `count*` where value that may be null or undefined is guarded before
   the call or goes through a helper that throws on a missing value. Unless `invalidWhereValuesBehavior` is set to
   throw, TypeORM drops an undefined key, so `findOne({ where: { id: dto.parentId } })` with `parentId` unset
   returns the table's first row. Right:
   `dto.parentId ? await repo.findOne({ where: { id: dto.parentId } }) : null`.
