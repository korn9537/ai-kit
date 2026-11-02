// Tests for run-plan-status.mjs: a fixture workflow journal to one status line per batch.
// Usage: node scripts/run-plan-status.test.mjs
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newestRun, nodePath, parseLabel, status } from "./run-plan-status.mjs";

let passed = 0;
let failed = 0;
function eq(desc, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    passed++;
    console.log(`ok   - ${desc}`);
  } else {
    failed++;
    console.log(`FAIL - ${desc}\n  got:  ${g}\n  want: ${w}`);
  }
}

eq("commit label", parseLabel("commit: [b1] Add table"), { key: "b1", title: "Add table", step: "commit" });
eq("fix label", parseLabel("commit: [b1 fix] Add table"), { key: "b1", title: "Add table", step: "fix" });
eq("review label", parseLabel("review: [b1] Add table"), { key: "b1", title: "Add table", step: "review" });
eq("recheck label", parseLabel("review: [b1 recheck] Add table"), { key: "b1", title: "Add table", step: "recheck" });
eq("title starting fix is a commit", parseLabel("commit: [b2] fix login"), { key: "b2", title: "fix login", step: "commit" });
eq("title starting recheck is a review", parseLabel("review: [b2] recheck x"), { key: "b2", title: "recheck x", step: "review" });
eq("fix marker on a review: other", parseLabel("review: [b2 fix] x").step, "agent");
eq("other label", parseLabel("probe"), { key: "probe", title: "probe", step: "agent" });
eq("Git Bash path on Windows", nodePath("/c/Users/x", "win32"), "c:/Users/x");
eq("posix path kept", nodePath("/c/Users/x", "darwin"), "/c/Users/x");

const NOW = 1_800_000_000_000;
const root = mkdtempSync(join(tmpdir(), "run-plan-status-"));
try {
  const session = join(root, "s1");
  const dir = join(session, "subagents", "workflows", "wf_1");
  mkdirSync(dir, { recursive: true });
  const ev = [
    { type: "launched" },
    { type: "started", agentId: "a1", label: "commit: [b1] Add table", phase: "Commit" },
    { type: "result", agentId: "a1", result: { hash: "a1b2c3d4e5", owner: [], blockers: [] } },
    { type: "started", agentId: "a2", label: "review: [b1] Add table", phase: "Review" },
    { type: "result", agentId: "a2", result: { reviewed: true, findings: [{ verdict: "CONFIRMED" }, { verdict: "PLAUSIBLE" }] } },
    { type: "started", agentId: "a3", label: "commit: [b1 fix] Add table", phase: "Fix" },
    { type: "started", agentId: "a4", label: "commit: [b2] fix API", phase: "Commit" },
    { type: "result", agentId: "a4", result: { hash: "", owner: ["which currency"], blockers: ["needs an owner answer"] } },
    { type: "started", agentId: "a5", label: "commit: [b3] Report", phase: "Commit" },
    { type: "result", agentId: "a5", result: { hash: "9f8e7d6c5b", owner: ["rounding"], blockers: [] } },
    { type: "started", agentId: "a7", label: "commit: [b4] Report", phase: "Commit" },
    { type: "result", agentId: "a7", result: JSON.stringify({ hash: "1234567890", owner: [], blockers: [], review: "skip" }) },
    { type: "started", agentId: "a6", label: "review: [b3] Report", phase: "Review" },
    { type: "result", agentId: "a6", result: null },
  ];
  writeFileSync(join(dir, "journal.jsonl"), ev.map((e) => JSON.stringify(e)).join("\n") + "\nnot json\n");
  writeFileSync(join(dir, "agent-a3.jsonl"), "{}");
  utimesSync(join(dir, "agent-a3.jsonl"), new Date(NOW - 2 * 60000), new Date(NOW - 2 * 60000));
  eq("while running", status(dir, NOW), [
    "wf_1: running, 6 agent(s) done, 1 running",
    "b1 Add table: commit a1b2c3d · review 1 CONFIRMED, 1 PLAUSIBLE · fix running",
    "b2 fix API: commit: not committed (needs an owner answer)",
    "b3 Report: commit 9f8e7d6 ⚠ owner: rounding · review failed or skipped",
    "b4 Report: commit 1234567 · review skipped, move-only or comment-only",
  ]);
  eq("idle agent flagged", status(dir, NOW + 20 * 60000)[1], "b1 Add table: commit a1b2c3d · review 1 CONFIRMED, 1 PLAUSIBLE · fix ⚠ no transcript write for 22m");
  eq("trailing slash", status(dir + "/", NOW)[0], status(dir, NOW)[0]);

  mkdirSync(join(session, "workflows"), { recursive: true });
  writeFileSync(join(session, "workflows", "wf_1.json"), JSON.stringify({ status: "running" }));
  eq("run record running", status(dir, NOW)[0], "wf_1: running, 6 agent(s) done, 1 running");
  writeFileSync(join(session, "workflows", "wf_1.json"), JSON.stringify({ status: "completed" }));
  eq("run over: no agent left running", status(dir + "/", NOW).slice(0, 2), [
    "wf_1: completed, 6 agent(s) done, 0 running",
    "b1 Add table: commit a1b2c3d · review 1 CONFIRMED, 1 PLAUSIBLE · fix stopped, no result",
  ]);

  const older = join(root, "s0", "subagents", "workflows", "wf_0");
  mkdirSync(older, { recursive: true });
  writeFileSync(join(older, "journal.jsonl"), "");
  utimesSync(join(older, "journal.jsonl"), new Date(NOW - 3600000), new Date(NOW - 3600000));
  utimesSync(join(dir, "journal.jsonl"), new Date(NOW), new Date(NOW));
  eq("newest run across sessions", newestRun(root), dir);
  eq("no project dir", newestRun(join(root, "missing")), "");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
