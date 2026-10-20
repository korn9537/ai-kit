# <Entity> (table `<table_name>`)

source: <path/to/migration-or-model>
written by: <module>

## Fields

| field | meaning |
|---|---|
| status | → §States |
| total_thb | sum of lines.amount, VAT included, satang precision |
| closed_at | null = still open |

## States

- draft → submitted: owner (role <role>)
- submitted → approved | rejected: role <role>
- approved: final, no edits

## Invariants

- I1: <rule a write must keep>
- I2: <rule>

## Relations

- belongs to <entity> → ai/data/<entity>.md
- has many <entity> → ai/data/<entity>.md

## Lifecycle

- delete: soft (`deleted_at`), restore window 30 days, then purge job
- PII: <fields> · retention: <rule>
