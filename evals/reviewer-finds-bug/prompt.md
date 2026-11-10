---
name: reviewer-finds-bug
tags: [reviewer]
runs: 1
allowed_tools: [Read, Grep, Glob, Task]
max_turns: 12
---
Launch the change-reviewer subagent (ai-kit:change-reviewer) on the diff below and reply with its findings unchanged.
The diff is the whole change; no repo is available, so judge it from the text.

```diff
--- a/src/page.ts
+++ b/src/page.ts
@@ -10,7 +10,7 @@ export function lastPage(total: number, size: number): number {
-  return Math.ceil(total / size);
+  return Math.floor(total / size) + 1;
 }
```

The commit message says: "lastPage: same result, simpler". `lastPage(20, 10)` is expected to be 2, the page count of
20 items at 10 a page.
