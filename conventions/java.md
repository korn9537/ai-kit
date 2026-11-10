# Java conventions

Reader: agents writing or reviewing Java. Adds to `general.md`.

1. **Absent values** — a method that may have no result returns `Optional<T>`, never `null`; a collection return
   is empty, never null. `Optional` is not used for fields or parameters, and `get()` is called only after
   `isPresent()` is proven: prefer `orElseThrow()`, `orElse` or `map`. Wrong: `User find(String id)` returning
   `null`. Right: `Optional<User> find(String id)`.
2. **try-with-resources** — a `Closeable` or `AutoCloseable` (stream, reader, connection, statement) opens in a
   try-with-resources header, never in a `finally` that closes it by hand. Wrong:
   `InputStream in = open(); try { ... } finally { in.close(); }`. Right: `try (InputStream in = open()) { ... }`.
3. **Money** — amounts are `BigDecimal` (or integer minor units), never `double` or `float`; built with
   `new BigDecimal("0.10")` or `BigDecimal.valueOf`, never `new BigDecimal(0.1)`; compared with `compareTo`, never
   `equals` (`2.0` and `2.00` differ); every division gives a `RoundingMode`.
4. **Catching exceptions** — never `catch (Exception e)` or `catch (Throwable t)` that neither rethrows nor logs
   with the exception; catch the specific types the code handles. An empty catch block carries a comment saying why
   it is safe. Wrap with the cause: `throw new StorageException("save failed", e)`.
5. **Equality** — strings and boxed values compare with `equals` (or `Objects.equals` when either side may be
   null), never `==`. A class that overrides `equals` overrides `hashCode` with the same fields.
6. **Immutable by default** — fields are `final`, value types are `record`s, and a returned collection is
   unmodifiable (`List.copyOf`, `Collections.unmodifiableList`) so a caller cannot change internal state.
7. **Parametrized SQL** — values reach JDBC as `PreparedStatement` parameters, never concatenated into the SQL
   string. Wrong: `stmt.executeQuery("... WHERE id = " + id)`. Right: `ps.setLong(1, id)`.
8. **Time** — `java.time` (`Instant`, `ZonedDateTime`, `LocalDate`), never `Date`, `Calendar` or
   `SimpleDateFormat`, which are mutable and not thread-safe.
