// Tests for kit.mjs init and check on line endings (the LF rules a Windows checkout needs) and the commit-msg shim.
// Usage: node scripts/kit-init.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dirname, "kit.mjs");
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
// HOME in the fixture: the user's settings and memory dir never reach the result
const run = (cwd, cmd) =>
  spawnSync("node", [SCRIPT, cmd], { cwd, encoding: "utf8", env: { ...process.env, HOME: cwd, CLAUDE_CONFIG_DIR: "" } }).stdout;
const lf = (repo) => execFileSync("git", ["check-attr", "eol", "--", ".githooks/pre-commit", "ai/kit/pre-commit.sh"], { cwd: repo, encoding: "utf8" });

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kit-init-")));
try {
  const repo = join(tmp, "repo");
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, ".gitattributes"), "*.png binary\r\n");
  eq("check: both rules missing is warned", (run(repo, "check").match(/has no eol=lf attribute/g) ?? []).length, 2);
  run(repo, "init");
  eq("init: the rules are appended, the file's CRLF kept", readFileSync(join(repo, ".gitattributes"), "utf8"),
    "*.png binary\r\n.githooks/* text eol=lf\r\nai/kit/*.sh text eol=lf\r\n");
  eq("init: git reads both paths as LF", lf(repo), ".githooks/pre-commit: eol: lf\nai/kit/pre-commit.sh: eol: lf\n");
  run(repo, "init");
  eq("init: a second run adds nothing", readFileSync(join(repo, ".gitattributes"), "utf8").split("eol=lf").length, 3);
  eq("check: no warning once set", run(repo, "check").includes("eol=lf attribute"), false);
  const fresh = join(tmp, "fresh");
  execFileSync("git", ["init", "-q", fresh]);
  eq("check: a missing commit-msg shim is warned", run(fresh, "check").includes(".githooks/commit-msg is missing"), true);
  run(fresh, "init");
  eq("init: writes the commit-msg shim", readFileSync(join(fresh, ".githooks", "commit-msg"), "utf8").includes("githooks/commit-msg"), true);
  eq("check: no warning once the shim is there", run(fresh, "check").includes(".githooks/commit-msg"), false);
  const own = join(tmp, "own-hook");
  execFileSync("git", ["init", "-q", own]);
  execFileSync("mkdir", ["-p", join(own, ".githooks")]);
  writeFileSync(join(own, ".githooks", "commit-msg"), "#!/bin/sh\nexit 0\n");
  eq("init: leaves a project's own commit-msg alone", run(own, "init").includes("commit-msg exists and does not run the kit"), true);
  eq("init: the project's hook is kept", readFileSync(join(own, ".githooks", "commit-msg"), "utf8"), "#!/bin/sh\nexit 0\n");
  eq("init: no shim written over it", existsSync(join(own, ".githooks", "commit-msg")), true);
  const planned = join(tmp, "planned");
  execFileSync("git", ["init", "-q", planned]);
  execFileSync("mkdir", ["-p", join(planned, "ai", "plans")]);
  writeFileSync(join(planned, "ai", "plans", "old.md"), "# Plan old\n\n| T-1 x | done | a |\n");
  writeFileSync(join(planned, "ai", "plans", "live.md"), "# Plan live\n\n| T-1 x | todo | a |\n");
  eq("check: a plan with no task left is warned", run(planned, "check").includes("ai/plans/old.md has no task left"), true);
  eq("check: a plan with work left is not", run(planned, "check").includes("ai/plans/live.md"), false);
  const bare = join(tmp, "no-attrs");
  execFileSync("git", ["init", "-q", bare]);
  run(bare, "init");
  eq("init: a repo without .gitattributes gets one", readFileSync(join(bare, ".gitattributes"), "utf8"),
    ".githooks/* text eol=lf\nai/kit/*.sh text eol=lf\n");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
