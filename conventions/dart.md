# Dart and Flutter conventions

Reader: agents writing or reviewing Dart. Adds to `general.md`; the repo's `ai/kit/review-checklist.md` wins on a
conflict and is where a repo writes an exception, with its reason.

1. **State after a write** — a response that carries the new state goes into the provider or state holder before
   any re-read, so a failed re-read never leaves the old value on screen.
2. **Tests** — a screen with logic (branches, validation, state changes) has a widget test.
3. **Touch targets** — >= 44pt.
