# TypeORM conventions

Reader: agents writing or reviewing TypeORM code. Adds to `general.md`, `typescript.md` and `sql.md`.

1. **Where values** — a `find*`, `exists*` or `count*` where value that may be null or undefined is guarded before
   the call or goes through a helper that throws on a missing value. Unless `invalidWhereValuesBehavior` is set to
   throw, TypeORM drops an undefined key, so `findOne({ where: { id: dto.parentId } })` with `parentId` unset
   returns the table's first row. Right:
   `dto.parentId ? await repo.findOne({ where: { id: dto.parentId } }) : null`.
2. **Migration timestamps** — every migration has a unique timestamp: the file name prefix and the class name suffix
   are one value, and no two migrations share it. Two with one timestamp have no defined order, so they can run in a
   different order on different databases. Before adding a migration, or merging a branch that adds one, compare it
   with every timestamp in the migrations directory. A duplicate found after a migration has run on any database is
   fixed by renumbering the later file (file name, class name and `name` together), and its `up()` must be safe to
   run again there, because the new name counts as pending. Wrong: `1700000000000-add-item-index.ts` and
   `1700000000000-drop-item-note.ts` from two branches. Right: the second is `1700000001000-drop-item-note.ts`, class
   `DropItemNote1700000001000`.
