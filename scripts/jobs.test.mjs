// Tests for jobs.mjs: a throwaway repo with a glob-like route path, a migration renamed inside its job, a plain
// revert, a reapplied revert and a Reverts-Job revert. Usage: node scripts/jobs.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
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

  // non-ASCII names: git quotes them in octal unless core.quotePath is off
  writeFileSync(join(tmp, "เอกสาร.txt"), "1\n");
  writeFileSync(join(tmp, "db", "เรื่อง.sql"), "1\n");
  commit("thai files", "2026-01-05-gamma");
  writeFileSync(join(tmp, "เอกสาร.txt"), "2\n");
  commit("thai edit", "2026-01-06-delta");
  out = jobs("gamma");
  ok("a Thai-named migration is listed as added", /Migrations added[\s\S]*  เรื่อง\n/.test(out), out);
  ok("a later job touching a Thai-named file is listed", /Later commits[\s\S]*thai edit/.test(out), out);

  // a job with no files must not list every later commit
  g("commit", "-q", "--allow-empty", "-m", "nothing", "-m", "Job: 2026-01-07-empty");
  writeFileSync(join(tmp, "x", "i", "p"), "c\n");
  commit("after empty", "2026-01-08-zeta");
  out = jobs("empty");
  ok("a job with no files prints no later commits", out.includes("Job 2026-01-07-empty") && !out.includes("Later commits"), out);

  // Job: above a separate Co-Authored-By paragraph
  g("commit", "-q", "--allow-empty", "-m", "split trailer", "-m", "Job: 2026-01-09-theta", "-m", "Co-Authored-By: a <a@b>");
  out = jobs("theta");
  ok("a Job: line above a Co-Authored-By paragraph is read", out.includes("Job 2026-01-09-theta: 1 commit(s)"), out);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const plain = mkdtempSync(join(tmpdir(), "jobs-plain-"));
const plainRun = (cwd) => {
  const r = spawnSync("node", [SCRIPT], { cwd, encoding: "utf8" });
  return { ...r, lines: (r.stdout + r.stderr).trim().split("\n") };
};
try {
  let r = plainRun(plain);
  ok("outside a repo: one line, no stack", r.status === 1 && r.lines.length === 1 && r.lines[0].startsWith("jobs:"), r);
  execFileSync("git", ["init", "-q"], { cwd: plain });
  r = plainRun(plain);
  ok("in an empty repo: the no-jobs line", r.status === 0 && r.lines.length === 1 && r.lines[0].startsWith("No commit carries"), r);
} finally {
  rmSync(plain, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
