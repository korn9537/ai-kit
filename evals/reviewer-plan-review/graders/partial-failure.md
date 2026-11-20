---
type: llm
criteria: The reply names, as a finding on batch b1, that the insert into orders_archive and the delete from orders are not one transaction (src/db.ts commits each query on its own), so a crash or retry between them leaves an order in both tables or duplicates it on the retry (the primary key on orders_archive.id then makes the retry fail forever). It says what b1 must also do (one transaction, or an idempotent insert such as ON CONFLICT DO NOTHING before the delete) and that a test must cover it. A reply that only repeats the risk the plan already lists, or that reports no finding, fails.
---
