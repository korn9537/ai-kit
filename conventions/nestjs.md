# NestJS conventions

Reader: agents writing or reviewing NestJS code. Adds to `general.md` and `typescript.md`.

1. **Large services** — rule: `general.md` item 12. A provider class over 40 KB cannot keep its callers unchanged
   (`typescript.md` item 11) without a delegating facade and a dependency cycle. Split it into sibling providers
   grouped by method region; repoint callers and the module's `providers` in the same commit; only cross-class
   calls change (`this.x` → `this.<dep>.x`). Shared helpers go to a provider that injects none of the others, so no
   `forwardRef`.
2. **Scheduled jobs** — `@Cron` names an explicit `timeZone` (the business zone constant), never relying on the
   process `TZ`: on a UTC host the job fires at another wall-clock hour. In an app that may run more than one
   replica, a scheduled run first claims its `(job, slot)` row by an insert under a unique key and works only when
   the insert wins (PostgreSQL: `INSERT ... ON CONFLICT DO NOTHING RETURNING id`); without it every replica does the
   work. The slot is the scheduled time computed in the business zone, never the fire time (`new Date()`), which
   differs per replica and never conflicts. Right: `@Cron('0 9 * * *', { name: 'digest', timeZone: BUSINESS_TZ })`,
   then claim `('digest', <today 09:00 in BUSINESS_TZ>)`.
3. **Nested routes** — a handler on a route with a parent path param reads that param and scopes its lookup by it.
   One that ignores it answers for a child of any other parent, and a permission check made on the parent protects
   nothing. Wrong: on `teams/:team_id/members/:id`, `find(@Param('id') id: string)` with `where: { id }`. Right:
   `find(@Param('team_id') teamId: string, @Param('id') id: string)` with `where: { id, team_id: teamId }`.
4. **Access rule on every write** — each POST, PUT, PATCH and DELETE handler carries an explicit access declaration
   through a project decorator: a required permission, admin-only, or a no-check with a written reason. Auth alone
   lets any logged-in user call every write route, and a missing declaration is invisible in review. A metadata test
   loads every controller, enumerates handlers via `Reflect` metadata, and fails on a mutating handler with none of
   the three declarations and on a controller with a mutating handler that lacks the permission guard. Existing gaps
   go in a baseline list the test lets only shrink. Attach the permission guard per controller after the
   authentication guard, never as a global guard: global guards run before route-level auth guards and see no user.
   Wrong: `@Post('close') close() {}` on a controller guarded only by an auth guard. Right:
   `@RequirePermission('ledger', 'close') @Post('close') close() {}`.
