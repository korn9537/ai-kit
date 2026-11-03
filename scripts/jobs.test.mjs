// Tests for jobs.mjs: a throwaway repo with a glob-like route path, a migration renamed inside its job, a plain
// revert, a reapplied revert and a Reverts-Job revert. Usage: node scripts/jobs.test.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dirname, "jobs.mjs");
let passed = 0;
let failed = 0;
function ok(desc, cond, out) {
  if (cond) {
    passed++;
    console.log(`ok   - ${desc}`);
  } else {
    failed++;
    console.log(`FAIL - ${desc}\n${out}`);
  }
}

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "jobs-")));
const g = (...a) => execFileSync("git", a, { cwd: tmp, encoding: "utf8" }).trim();
const jobs = (...a) => {
  try {
    return execFileSync("node", [SCRIPT, ...a], { cwd: join(tmp, "x"), encoding: "utf8" });
  } catch (e) {
    return e.stdout;
  }
};
const commit = (subject, job) => {
  g("add", "-A");
  g("commit", "-q", "-m", subject, "-m", `Job: ${job}`);
  return g("rev-parse", "HEAD");
};
try {
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  mkdirSync(join(tmp, "x", "[id]"), { recursive: true });
  mkdirSync(join(tmp, "x", "i"), { recursive: true });
  mkdirSync(join(tmp, "db"), { recursive: true });
  mkdirSync(join(tmp, "ai", "kit"), { recursive: true });
  writeFileSync(join(tmp, "ai", "kit", "config.json"), JSON.stringify({ jobs: { migrations: "^db/[^/]+\\.sql$" } }));
  writeFileSync(join(tmp, "x", "[id]", "p"), "a\n");
  writeFileSync(join(tmp, "db", "001_a.sql"), "1\n");
  commit("one", "2026-01-01-alpha");
  g("mv", "db/001_a.sql", "db/002_a.sql");
  commit("restamp", "2026-01-01-alpha");
  writeFileSync(join(tmp, "x", "i", "p"), "b\n");
  commit("glob neighbour", "2026-01-02-beta");
  writeFileSync(join(tmp, "x", "[id]", "p"), "a\nc\n");
  commit("same file", "2026-01-02-beta");

  let out = jobs("alpha");
  ok("run from a subdirectory: the job's files are repo-wide", out.includes("db/002_a.sql"), out);
  ok("migration renamed inside the job shows its last name", out.includes("  002_a\n") && !out.includes("  001_a\n"), out);
  ok("[id] is literal: the i/ neighbour is no conflict", out.includes("same file") && !out.includes("glob neighbour"), out);
  ok("live job prints the revert command", out.includes("git revert --no-commit"), out);

  g("revert", "--no-edit", "HEAD");
  out = jobs();
  ok("plain revert of one of two commits → partly reverted", out.includes("2026-01-02-beta  2 commit(s)") && out.includes("[partly reverted: 1 of 2]"), out);
  out = jobs("beta");
  ok("the revert commit is not listed as a later conflict", !/Later commits[\s\S]*Revert "same file"/.test(out), out);
  ok("revert command lists only the live commit", (out.match(/git revert --no-commit (.*)/)?.[1] ?? "").split(" ").length === 1, out);

  g("revert", "--no-edit", "HEAD");
  out = jobs();
  ok("reverting the revert makes the job live again", !/2026-01-02-beta.*reverted/.test(out), out);

  // the trailer alone marks the job: an empty commit stands in for the revert
  g("commit", "-q", "--allow-empty", "-m", "revert: alpha", "-m", "Job: 2026-01-03-undo-alpha\nReverts-Job: 2026-01-01-alpha");
  out = jobs("2026-01-01-alpha");
  ok("Reverts-Job marks the whole job reverted", out.includes("Already reverted"), out);
  out = jobs("alpha");
  ok("a substring matching two jobs lists both", out.includes("matches several jobs"), out);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
