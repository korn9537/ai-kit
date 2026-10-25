# Dart and Flutter conventions

Reader: agents writing or reviewing Dart. Adds to `general.md`.

1. **State after a write** — a response that carries the new state goes into the provider or state holder before
   any re-read, so a failed re-read never leaves the old value on screen.
2. **Tests** — a screen with logic (branches, validation, state changes) has a widget test.
3. **Touch targets** — >= 44pt.
4. **User-facing strings** — through the app's generated localizations (gen-l10n ARB, `AppLocalizations`), never a
   literal in a widget; every ARB file has the same keys, and dates and numbers go through one locale-aware helper.
