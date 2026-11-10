# React conventions

Reader: agents writing or reviewing React components. Adds to `general.md` and `typescript.md`.

1. **Rules of hooks** — hooks are called at the top level of a component or a custom hook, never inside a
   condition, loop or nested function, and an early `return` comes after them. The call order must be the same on
   every render. Wrong: `if (!user) return null; const [tab, setTab] = useState(0);`. Right: the `useState` first.
2. **List keys** — a list item's `key` is a stable id from the data, never the array index, unless the list is
   static and never reordered. With an index key, an insert or delete moves state and focus to the wrong row.
   Wrong: `rows.map((r, i) => <Row key={i} />)`. Right: `rows.map((r) => <Row key={r.id} />)`.
3. **No derived state** — a value computable from props or other state is computed during render (`useMemo` only
   when measured slow), not copied into `useState` and synced in an effect: the copy is stale for one render and
   drifts. Wrong: `const [full, setFull] = useState(a + b)` with an effect that calls `setFull`. Right:
   `const full = a + b`.
4. **Effects** — `useEffect` only to sync with a system outside React (a subscription, a timer, the DOM, a
   third-party widget). An event's work runs in its handler, not in an effect keyed on the state the event set. Every
   effect that starts something returns its cleanup.
5. **Dependency arrays** — every reactive value an effect or callback reads is in its dependency array, and the lint
   rule `react-hooks/exhaustive-deps` is an error. A silenced warning is fixed by moving the value or the function,
   not by deleting the dependency.
6. **State updates** — a state change that depends on the previous state uses the updater form, never the captured
   value. Wrong: `setCount(count + 1)` twice in one handler adds 1. Right: `setCount((c) => c + 1)`.
7. **No mutation** — state and props are never mutated; a new array or object is set. Wrong:
   `items.push(x); setItems(items)` (same reference, no re-render). Right: `setItems([...items, x])`.
8. **Components defined at top level** — a component is never declared inside another component's body: it is a new
   type on every render, so its subtree remounts and loses its state.
9. **Raw HTML** — `dangerouslySetInnerHTML` only with a value sanitized by a maintained library (DOMPurify), with
   the call site naming it. User text is rendered as children.
