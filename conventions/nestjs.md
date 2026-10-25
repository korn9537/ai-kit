# NestJS conventions

Reader: agents writing or reviewing NestJS code. Adds to `general.md` and `typescript.md`; the repo's
`ai/kit/review-checklist.md` wins on a conflict and is where a repo writes an exception, with its reason.

1. **Large services** — a provider class over 40 KB cannot keep its callers unchanged (`typescript.md` item 11)
   without a delegating facade and a dependency cycle. Split it, move-only, into sibling providers grouped by method
   region; repoint callers and the module's `providers` in the same commit; only cross-class calls change
   (`this.x` → `this.<dep>.x`). Shared helpers go to a provider that injects none of the others, so no `forwardRef`.
