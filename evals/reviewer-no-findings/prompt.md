---
name: reviewer-no-findings
tags: [reviewer]
runs: 1
allowed_tools: [Read, Grep, Glob, Agent]
max_turns: 12
---
Launch the change-reviewer subagent (ai-kit:change-reviewer) on the diff below and reply with its findings unchanged.
The diff is the whole change; no repo is available, so judge it from the text.

The user's request: "Rename `getUser` to `fetchUser` in src/users.ts and its callers; nothing else."

Done when:
- `fetchUser` is exported from src/users.ts with the same signature and body as `getUser` had.
- Every caller of `getUser` calls `fetchUser`; `grep -rn getUser src/` finds nothing.
- No other line changes.

What the caller knows, inline because the sandbox holds no repo: before the change, `grep -rn getUser src/` listed
exactly five lines: `src/users.ts:3` (the export), `src/profile.ts:1` and `:4`, `src/admin/list.ts:1` and `:4` (each
caller's import and call). There is no test file that names `getUser`. `ai/kit/review-checklist.md` does not exist.

```diff
--- a/src/users.ts
+++ b/src/users.ts
@@ -1,5 +1,5 @@
 import { db } from "./db";

-export async function getUser(id: string): Promise<User | null> {
+export async function fetchUser(id: string): Promise<User | null> {
   return db.users.findUnique({ where: { id } });
 }
--- a/src/profile.ts
+++ b/src/profile.ts
@@ -1,5 +1,5 @@
-import { getUser } from "./users";
+import { fetchUser } from "./users";

 export async function profileOf(id: string) {
-  const user = await getUser(id);
+  const user = await fetchUser(id);
   if (!user) return null;
--- a/src/admin/list.ts
+++ b/src/admin/list.ts
@@ -1,5 +1,5 @@
-import { getUser } from "../users";
+import { fetchUser } from "../users";

 export async function ownerRow(id: string) {
-  const owner = await getUser(id);
+  const owner = await fetchUser(id);
   return owner ? { id: owner.id, name: owner.name } : { id, name: "(deleted)" };
```
