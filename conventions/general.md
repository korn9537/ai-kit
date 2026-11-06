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
   A filter or sort on a derived field (a status computed from several columns) uses the rule that derives it,
   defined once (one SQL expression or function) and called by the field, the filter and the sort, never restated
   on raw columns; the filter accepts only the derived values, anything else is a 400.
8. **No query in a loop** — no database read inside a loop: batch-fetch the rows first, then look them up.
9. **Authorization** — the server enforces every permission, default deny, and every other write rule (a locked
   field, a state that allows no edit, a record frozen after approval) by rejecting the write itself; a client-side
   gate or disabled field is UX only. Each such lock has a test that calls the endpoint directly.
10. **Secrets** — none in committed config: keep the key shape with empty values, real values come from the
    environment.
11. **One screen = one server read** — a screen's data comes from one server read (endpoint, query, loader, server
    component) that composes it; the client only formats, never joins responses or computes business values
    (totals, status, what a role may do). Extra reads only for cached lookups, parts loaded on their own, a
    sub-list with its own paging; a repo with screen specs declares them there (`docs/screen-specs.md`).
12. **Large files** — a source file over 40 KB that you need to edit is split first, move-only, in its own commit.
    A lint error the move surfaces is fixed in a follow-up commit, or its suppression names the real reason the rule
    does not apply; "moved verbatim" is no reason (pre-commit rejects it). Pre-commit also rejects an edit to a
    code file over 40 KB at HEAD that adds more than moved lines, imports and the `partial` a C# split puts on its
    class line (`ALLOW_LARGE_EDIT=1` when it cannot wait). How: `typescript.md` item 11, `csharp.md` item 11,
    `nestjs.md` item 1.
13. **Limits and thresholds** — compare a value with a threshold, limit or gate unrounded; round only to format
    for display, never before the decision (`10.004` rounded to `10.00` passes a `<= 10.00` check it fails). A
    number shown next to its limit (a daily total beside its cap) comes from the same function that enforces the
    limit, never a second calculation in the display code.
14. **Client IP** — a forwarding header (`X-Forwarded-For`, `X-Real-IP`) is read only when the TCP peer is inside a
    configured trusted-proxy CIDR list, empty by default; otherwise the client is the TCP peer. Never a middleware
    that trusts the header from any peer: a client could pick its own rate-limit or audit key.
15. **Request bodies** — a request type declares only what the caller decides, never a field the server overwrites
    or ignores: the call returns 2xx, the value is lost, the API docs say it counts, and a handler that skips the
    reset lets a caller forge it. A value the server sets (origin, actor, status) stays out of the request type: the
    endpoint has its own type, mapped to the internal one in one place, and an internal or domain type is never a
    request body. Wrong: `Refund(amount, approved_by)` as the body of `POST /orders/{id}/refunds`, the handler
    resetting `approved_by`. Right: `RefundRequest(amount)`, and one mapper builds the internal `Refund` with the
    actor the server sets.
