# Flutter conventions

Reader: agents writing or reviewing Flutter widgets. Adds to `general.md` and `dart.md`.

1. **const constructors** — a widget with only final fields has a `const` constructor and is built with `const`
   wherever its arguments are constant; the lint rules `prefer_const_constructors` and
   `prefer_const_literals_to_create_immutables` are on. A `const` widget is skipped on rebuild.
2. **Dispose what you create** — a `TextEditingController`, `ScrollController`, `AnimationController`, `FocusNode`
   or `StreamSubscription` that a `State` creates is disposed or cancelled in `dispose()`, before `super.dispose()`.
3. **No BuildContext across an async gap** — after an `await`, check `if (!context.mounted) return;` (inside a
   `State`, `mounted`) before using the context, or read what you need (navigator, messenger, localizations) before
   the await. Wrong: `await save(); Navigator.of(context).pop();`. Right:
   `await save(); if (!context.mounted) return; Navigator.of(context).pop();`.
4. **One state management approach** — the app uses one library (Riverpod, Bloc, Provider) for shared state; a
   `StatefulWidget` holds only state local to that widget (a controller, an animation, a tab index). A second
   library, or a global singleton holding screen state, is not added beside it.
5. **No work in build** — `build()` is pure: no network call, no navigation, no `setState`, no object that needs
   disposing. It runs on every frame the widget rebuilds. Start the work in `initState`, a provider or an event
   handler.
6. **Lists** — a list of unknown or large length uses `ListView.builder` (or `.separated`), not a `ListView` with
   `children: items.map(...)`, which builds every row at once. Rows in a reorderable or changing list carry a `Key`
   from the item's id.
7. **Themes** — rule: `general.md` item 5. The token source is `Theme.of(context)` (`ColorScheme`, `TextTheme`, or a
   `ThemeExtension` for app tokens), so dark mode follows. Wrong: `Color(0xFF1A73E8)`. Right:
   `Theme.of(context).colorScheme.primary`.
