# General conventions

Reader: agents writing or reviewing code in any repo that carries the kit. Applies in every language; the files
listed in `ai/kit/config.json` `conventions` add per-language rules. The repo's `ai/kit/review-checklist.md` wins
on a conflict and is where a repo writes an exception, with its reason.

1. **HTTP API** — JSON bodies and enum values in snake_case on the wire; errors in the RFC 9457 problem-details
   shape; ids created at runtime are opaque, time-ordered values (UUID v7, ULID), never sequential integers (fixed
   seed ids may be readable).
2. **Time** — timestamps stored and sent in UTC; a user-facing "day" (daily totals, end-of-day jobs, date filters)
   comes from an explicit IANA timezone (the user's, or the business's when the product has one), never the
   server's local zone.
3. **Generated files** — never edited by hand; change the source and rerun the generator. The repo's `CLAUDE.md`
   lists how generated files are named.
4. **Docs move with code** — a schema, endpoint or rule change updates its doc in the same change.
5. **UI basics** — colors and type sizes from design tokens; no raw color or font-size literals, except in a brand
   mark (third-party logo). Touch targets >= 24px (WCAG 2.2 AA); a label (accessibility text) on every icon-only
   button; text contrast >= 4.5:1.
6. **One save = one write request** — a submit, dialog save or button sends one write, and the server writes
   everything it implies in one transaction. No chained, looped or parallel mutations from the client, and no
   swallowed error on a write. Files upload first and the save carries their ids; many rows go to one bulk
   endpoint. A state change with business meaning (approve, cancel) is its own command (endpoint or mutation),
   not a field in a generic update.
7. **Lists** — list endpoints that can grow are paged with a default and a cap; a size over the cap is cut to it
   or refused, never unbounded; a negative size is a 400. Filter, count, order and page run in the database. A
   fixed small set (roles, statuses) or one parent's own trail (a record's event history) may be returned whole.
8. **No query in a loop** — no database read inside a loop: batch-fetch the rows first, then look them up.
9. **Authorization** — the server enforces every permission, default deny; a client-side gate is UX only.
10. **Secrets** — none in committed config: keep the key shape with empty values, real values come from the
    environment.
11. **One screen = one server read** — a screen's data comes from one server read (endpoint, query, loader, server
    component) that composes it; the client only formats, never joins responses or computes business values
    (totals, status, what a role may do). Extra reads only for cached lookups, parts loaded on their own, a
    sub-list with its own paging; a repo with screen specs declares them there (`docs/screen-specs.md`).
