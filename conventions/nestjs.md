# NestJS conventions

Reader: agents writing or reviewing NestJS code. Adds to `general.md` and `typescript.md`.

1. **Large services** — rule: `general.md` item 12. A provider class over 40 KB cannot keep its callers unchanged
   (`typescript.md` item 11) without a delegating facade and a dependency cycle. Split it into sibling providers
   grouped by method region; repoint callers and the module's `providers` in the same commit; only cross-class
   calls change (`this.x` → `this.<dep>.x`). Shared helpers go to a provider that injects none of the others, so no
   `forwardRef`.
