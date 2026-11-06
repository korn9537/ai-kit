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
