# Dart and Flutter conventions

Reader: agents writing or reviewing Dart. Adds to `general.md`.

1. **State after a write** — a response that carries the new state goes into the provider or state holder before
   any re-read, so a failed re-read never leaves the old value on screen.
2. **Tests** — a screen with logic (branches, validation, state changes) has a widget test.
3. **Touch targets** — >= 44pt.
4. **User-facing strings** — through the app's generated localizations (gen-l10n ARB, `AppLocalizations`), never a
   literal in a widget; every ARB file has the same keys, and dates and numbers go through one locale-aware helper.
5. **Golden images** — a commit that adds, changes or deletes a golden PNG names the command that regenerated it
   in its message body: `Regenerated with: flutter test --update-goldens <test path>`. The diff of a binary image
   shows neither which tests produced it nor whether it is stale.
