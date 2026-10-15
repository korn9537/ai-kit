# Go conventions

Reader: agents writing or reviewing Go. Adds to `general.md`; the repo's `ai/kit/review-checklist.md` wins on a
conflict and is where a repo writes an exception, with its reason.

1. **Tests** — table-driven `go test`: one slice of cases, one loop, `t.Run` per case name.
2. **Generated code** — oapi-codegen, sqlc and mock output is never hand-edited; change the spec, query or
   interface and rerun `go generate`.
3. **Vet** — `go vet ./...` stays clean.
