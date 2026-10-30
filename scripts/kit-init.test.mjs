// Tests for kit.mjs init and check on line endings: the LF rules a Windows checkout (core.autocrlf) needs.
// Usage: node scripts/kit-init.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
