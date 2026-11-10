# Python conventions

Reader: agents writing or reviewing Python. Adds to `general.md`.

1. **Typed signatures** — every public function and method annotates its parameters and return type, and the repo
   runs a type checker (mypy or pyright) in CI. An unannotated signature makes the checker treat every caller as
   valid. Wrong: `def total(items, rate):`. Right: `def total(items: list[Item], rate: Decimal) -> Decimal:`.
2. **No bare except** — catch the exceptions the code can handle, never `except:` or a silent
   `except Exception: pass`. A bare `except:` also swallows `KeyboardInterrupt` and `SystemExit`. Wrong:
   `try: save(x)` `except: pass`. Right: `except OSError as e: log.warning("save failed: %s", e); raise`.
3. **Mutable defaults** — a default argument is never a list, dict or set: the object is built once at definition
   and shared by every call. Wrong: `def add(x, seen=[]):`. Right: `def add(x, seen=None):` and
   `seen = [] if seen is None else seen`.
4. **Aware datetimes** — build datetimes with a timezone: `datetime.now(timezone.utc)`, never `datetime.now()`,
   `datetime.utcnow()` or `utcfromtimestamp()`, which return naive values that compare wrongly with aware ones and
   take the host's zone when converted.
5. **Parametrized SQL** — values reach a query as bound parameters, never through an f-string, `%` or `.format()`.
   Wrong: `cur.execute(f"SELECT * FROM users WHERE id = {uid}")`. Right:
   `cur.execute("SELECT * FROM users WHERE id = %s", (uid,))`.
6. **Files and resources** — open files, connections and locks in a `with` block so they close on an error.
   Wrong: `f = open(p); data = f.read()`. Right: `with open(p) as f: data = f.read()`.
7. **Money** — amounts are `Decimal` built from a string or an integer, never a `float`. Wrong: `Decimal(0.1)`.
   Right: `Decimal("0.1")`.
8. **Path handling** — paths are built with `pathlib.Path`, not string concatenation, so separators and
   absolute-path joins behave the same on every OS.
