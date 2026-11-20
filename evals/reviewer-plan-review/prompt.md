---
name: reviewer-plan-review
tags: [reviewer]
runs: 1
allowed_tools: [Read, Grep, Glob, Agent]
max_turns: 12
---
Launch the change-reviewer subagent (ai-kit:change-reviewer) with the plan review below and reply with its findings
unchanged. No repo is available, so it judges from the text; the code it would read is quoted inline.

The user's request: "Archive orders older than two years into `orders_archive` every night, then delete them from
`orders`."

Plan review: no code is written yet. Read this plan, not a commit, and read the code each batch touches.

Batch b1 (size normal): archive job
Brief: add `src/jobs/archive-orders.ts`: select orders with `created_at < now() - interval '2 years'`, insert them
into `orders_archive`, then `DELETE FROM orders WHERE id = ANY($ids)`. Schedule it at 02:00 from `src/jobs/index.ts`.
Done when:
- An order older than two years is in `orders_archive` and gone from `orders` after one run.
- An order younger than two years is untouched.
risks:
- the job runs while the API writes orders (an order created mid-run is younger than two years, so the select
  never picks it)
tests:
- archive-orders.test.ts: a 3-year-old order moves, a 1-year-old order stays

Batch b2 (size light): docs
Brief: document the job in `ai/data/orders.md`: "Orders older than two years live in `orders_archive`; `orders`
holds only the last two years."
Done when:
- `ai/data/orders.md` names the archive table and the two-year rule.
risks: none: docs only
tests: none: docs only

Code the batches touch, quoted because the sandbox holds no repo. `src/db.ts:10-14`:

```ts
export async function query(sql: string, params: unknown[] = []) {
  return pool.query(sql, params); // no transaction: each call commits on its own
}
```

`src/jobs/index.ts:1-6` registers jobs with `schedule(cron, fn)`; a job that throws is logged and retried on the
next tick. `orders_archive` has the columns of `orders` plus `archived_at timestamptz not null default now()` and a
primary key on `id`.
