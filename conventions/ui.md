# UI conventions

Reader: agents writing or reviewing user-facing screens: web, mobile and tablet. Adds to `general.md`.

Used beside the project's stack file (react, flutter), when `ui` is named in `ai/kit/config.json` `conventions`.
Look and style (palette, type, spacing) belong to the project's design system, not here. Each item ends with its
source; an item without one is a kit rule.

## All platforms

1. **Visible status** — an action that waits on the server shows it is working (a spinner on the control, a
   skeleton for a region) and ends in a visible result: a success message, the changed data, or an error. Never a
   silent success or a silent failure. A status message that does not move focus is announced to screen readers
   (`aria-live`, Flutter `SemanticsService`). The screen's loading, empty and error states come from its spec
   `states` key (`docs/screen-specs.md`); an empty state says why it is empty and offers the next action.
   Source: NN/g heuristic 1, WCAG 4.1.3.
2. **Double submission** — a submit ignores a second press while its request is pending, and shows that it is
   pending. The server still guards it (an idempotency key or a unique constraint): the client gate is UX only
   (`general.md` item 9). A submit is not disabled until the form is valid; it stays enabled and a press shows the
   errors. Source: GOV.UK Design System, Button.
3. **Labels and input types** — every input has a visible label; a placeholder is an example value, never the
   label (it disappears on typing). Optional or required is set through the shared field component's prop, never
   by hand-written markers. The input type fits the data, so the right keyboard opens (email, phone, numeric), and
   a field for the user's own data (name, email, phone, address) sets `autocomplete` (Flutter `autofillHints`).
   Source: WCAG 3.3.2, 1.3.5.
4. **Validation timing** — fields are validated when the user submits or continues to the next step, not when
   focus leaves a field and not while typing. Exceptions: a character count, a password strength meter. A failed
   submit keeps every value entered, shows each error next to its field, and moves focus to the first error (on
   web, to an error summary at the top that links to each field). Source: GOV.UK Design System, Validation;
   WCAG 3.3.1.
5. **Error messages** — say what is wrong and how to fix it, in the user's terms. Never the raw server text, a
   status code or a stack trace, and never "Something went wrong" alone. Each problem-details `type` the screen can
   receive maps to its own copy key in the spec's `## Copy` table; an unknown one shows a general message with a
   retry and keeps the problem's `instance` (or the response's request-id header) for support. Wrong:
   "422 Unprocessable Entity". Right: "Enter a date on or after the start date". Source: WCAG 3.3.3, NN/g
   heuristic 9.
6. **Destructive actions** — an action with an undo or restore command in the API spec runs at once and offers
   Undo (a snackbar or toast). One without asks first: the dialog names the object and the consequence, and the
   confirm button names the verb. Wrong: "Are you sure?" with OK. Right: "Delete invoice INV-0012? Its payments
   are removed too." with "Delete invoice". Source: NN/g heuristics 3 and 5.
7. **No re-entry, no lost work** — data the user entered earlier in the same flow is prefilled or offered for
   selection (WCAG 3.3.7). Leaving a screen with unsaved edits asks first (a router guard, `beforeunload`,
   `PopScope`); this half is a kit rule.
8. **Color is not the only signal** — a status has text or an icon beside its color; an invalid field has a
   message, not only a red border. Contrast: text per `general.md` item 5; input borders, focus rings and icons
   that carry meaning 3:1 against what is next to them, checked where the token pairs are defined. A component
   uses the token meant for its role (the outline token for an input border), never a nearby one that happens to
   look right. Source: WCAG 1.4.1, 1.4.3, 1.4.11.
9. **Accessible names** — every control exposes a name and a role: native elements first, a custom widget gets the
   role and state attributes (`aria-*`, Flutter `Semantics`). An image has alternative text, or is marked
   decorative. Source: WCAG 4.1.2, 1.1.1.
10. **Motion** — animation shows a change (where a panel came from, what was added) and lasts 200 to 300 ms, at
    most 500 ms for a full-screen transition. It turns off when the system asks for reduced motion
    (`prefers-reduced-motion`, `MediaQuery.disableAnimationsOf`). Content that moves by itself for more than five
    seconds can be paused. Source: WCAG 2.2.2, 2.3.3 (AAA).
11. **Shared parts** — a screen is built from the project's shared components, and an action that exists
    elsewhere reuses its copy key and icon, never a new string or a one-off copy of the component.
    Source: NN/g heuristic 4.
12. **Connection loss** — a request that fails for no connection says so, keeps what the user entered and offers
    a retry. A screen spec writes its offline behavior under `mobile` (`docs/screen-specs.md`).

## Thai text and locale

Items 13 and 14 apply in a product with Thai copy (a `th` column in a spec's `## Copy` table).

13. **Thai text** — body text with Thai has a line height of at least 1.5, and no text box, button or table cell
    has a fixed height that clips the marks above and below a line. No `letter-spacing` on Thai text (it splits
    vowels and tone marks from their consonant). No `word-break: break-all` (it breaks inside a syllable); line
    breaking is left to the platform. A label has no fixed width, and no `line-clamp` or `maxLines` without an
    overflow (ellipsis) and the full value one tap or hover away. The font stack loads a Thai face.
14. **Dates, numbers, money** — formatted by one locale formatter (`Intl`, the `intl` package), never by joining
    strings. Buddhist or Gregorian year is a decision in `ai/decisions.md` used on every screen; a date input
    accepts the year form the screen shows. Amounts have thousands separators and the product's fixed decimals.
    Stored and sent values stay ISO and Gregorian (`general.md` item 2).

## Web

15. **Keyboard** — every action works with the keyboard: tab order follows the visual order, Enter and Space
    activate, Escape closes a dialog or menu. Focus is always visible (an `outline` removed has a replacement) and
    never fully hidden under a sticky header or a banner. A dialog keeps focus inside and returns it to the control
    that opened it. Source: WCAG 2.1.1, 2.4.3, 2.4.7, 2.4.11.
16. **Native elements** — an action is a `<button>`, a navigation is an `<a href>`, an input is in a `<form>` so
    Enter submits. Wrong: `<div onClick={save}>`. Right: `<button type="submit">`. Source: WCAG 4.1.2.
17. **Nothing only on hover** — hover may add a hint; the same content and actions are reachable by tap and by
    keyboard focus (touch laptops and tablets have no hover).
18. **Reflow** — the page works from 320 CSS px wide up, and at 200% text zoom, without horizontal page scroll: no
    page-level container with a fixed `width` or `min-width` over 320 px, font sizes in `rem`, no fixed `height`
    on a box that holds text, and a wide table inside its own `overflow-x: auto` container. Source: WCAG 1.4.4,
    1.4.10.
19. **State in the URL** — filter, sort, tab, page and the selected record are in the URL, and Back returns to the
    previous state. Source: NN/g heuristic 3.

## Mobile and tablet

20. **Touch targets** — 44x44 pt on iOS and iPadOS (Apple's default control size; its 28 pt minimum is not used)
    and 48x48 dp on Android, as the control itself or as padding around a smaller icon, with at least 8 dp between
    targets. A web layout below the medium width (item 23) or under `(pointer: coarse)` uses 44 CSS px; the 24 px of
    `general.md` item 5 is the floor for fine-pointer layouts only. Source: Apple Human Interface Guidelines,
    Android accessibility guidelines.
21. **Platform behavior** — back works the platform's way (Android system and predictive back, iOS edge swipe) and
    is blocked only by the unsaved-edits guard of item 7. Date and time use the platform pickers unless the design
    system defines its own.
22. **Safe areas and the keyboard** — content stays inside the safe area (`SafeArea`,
    `env(safe-area-inset-*)`). A focused input scrolls above the on-screen keyboard, and the keyboard's action key
    moves to the next field or submits.
23. **Layout by width, not device** — layout follows the window's width, never a phone-or-tablet check on the
    device: a tablet in split view is as narrow as a phone. Widths follow the window size classes: compact under
    600 dp, medium 600 to 839, expanded 840 to 1199, large and extra-large from 1200. From medium up, a list and
    its detail sit side by side, a navigation rail replaces the bottom bar, and a text column is at most 840 dp
    wide instead of stretching the phone layout. Both orientations work. A tablet with a keyboard or pointer also
    follows items 15 and 17. Source: Android window size classes, Material Design 3; WCAG 1.3.4.
