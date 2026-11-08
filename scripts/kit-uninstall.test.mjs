// Tests for kit.mjs uninstall: reverses init's wiring, leaves ai/kit/ unless --purge, never touches what it did not write.
// Usage: node scripts/kit-uninstall.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
const run = (cwd, ...cmd) =>
  spawnSync("node", [SCRIPT, ...cmd], { cwd, encoding: "utf8", env: { ...process.env, HOME: cwd, CLAUDE_CONFIG_DIR: "" } });
const hooksPath = (repo) => spawnSync("git", ["config", "core.hooksPath"], { cwd: repo, encoding: "utf8" }).stdout.trim();

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kit-uninstall-")));
try {
  const repo = join(tmp, "repo");
  execFileSync("git", ["init", "-q", repo]);
  run(repo, "init");
  writeFileSync(
    join(repo, ".claude", "settings.json"),
    JSON.stringify({ autoMemoryEnabled: false, enabledPlugins: { "ai-kit@korn9537": true } }, null, 2),
  );
  writeFileSync(join(repo, "CLAUDE.md"), "# Project\n\nSome text.\n\nBefore writing code, read `ai/kit/conventions/`.\n");

  const out = run(repo, "uninstall").stdout;
  eq("uninstall: removes the pre-commit shim", existsSync(join(repo, ".githooks", "pre-commit")), false);
  eq("uninstall: removes the commit-msg shim", existsSync(join(repo, ".githooks", "commit-msg")), false);
  eq("uninstall: removes the now-empty .githooks/", existsSync(join(repo, ".githooks")), false);
  eq("uninstall: unsets core.hooksPath", hooksPath(repo), "");
  eq("uninstall: drops the CLAUDE.md pointer line and its blank line", readFileSync(join(repo, "CLAUDE.md"), "utf8"), "# Project\n\nSome text.\n");
  eq("uninstall: removes ai-kit from enabledPlugins, keeps the rest", JSON.parse(readFileSync(join(repo, ".claude", "settings.json"), "utf8")), { autoMemoryEnabled: false });
  eq("uninstall: removes the git-common-dir marker", existsSync(join(repo, ".git", "ai-kit-root")), false);
  eq("uninstall: leaves ai/kit/ unless --purge", existsSync(join(repo, "ai", "kit", "config.json")), true);
  eq("uninstall: says what it did", out.includes("ai-kit uninstalled"), true);
  eq("uninstall: a second run is a no-op, not a crash", run(repo, "uninstall").status, 0);

  eq("uninstall --purge: removes ai/kit/ too", run(repo, "uninstall", "--purge").stdout.includes("- ai/kit/"), true);
  eq("uninstall --purge: ai/kit/ is gone", existsSync(join(repo, "ai", "kit")), false);

  // a project's own hook beside the shim: core.hooksPath stays, the exit code says something was left
  const shared = join(tmp, "shared");
  execFileSync("git", ["init", "-q", shared]);
  run(shared, "init");
  mkdirSync(join(shared, ".githooks"), { recursive: true });
  writeFileSync(join(shared, ".githooks", "post-commit"), "#!/bin/sh\nexit 0\n");
  const res = run(shared, "uninstall");
  eq("uninstall: leaves core.hooksPath when another hook still lives in .githooks/", hooksPath(shared), ".githooks");
  eq("uninstall: reports what it left, and exits 1", [res.stdout.includes("core.hooksPath left as .githooks"), res.status], [true, 1]);
  eq("uninstall: the other hook is untouched", existsSync(join(shared, ".githooks", "post-commit")), true);

  // a hook that is not the ai-kit shim is a project's own: left alone, not deleted
  const own = join(tmp, "own");
  execFileSync("git", ["init", "-q", own]);
  mkdirSync(join(own, ".githooks"), { recursive: true });
  writeFileSync(join(own, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: own });
  const ownOut = run(own, "uninstall").stdout;
  eq("uninstall: a non-kit pre-commit hook is left as it is", ownOut.includes("is not the ai-kit shim, left as it is"), true);
  eq("uninstall: the project's own hook survives", readFileSync(join(own, ".githooks", "pre-commit"), "utf8"), "#!/bin/sh\nexit 0\n");

  // no CLAUDE.md, no .claude/settings.json, no .githooks: uninstall has nothing to do and does not throw
  const bare = join(tmp, "bare");
  execFileSync("git", ["init", "-q", bare]);
  const bareRes = run(bare, "uninstall");
  eq("uninstall: a repo the kit never touched exits clean", bareRes.status, 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
