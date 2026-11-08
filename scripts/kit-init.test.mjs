// Tests for kit.mjs init and check on line endings (the LF rules a Windows checkout needs) and the commit-msg shim.
// Usage: node scripts/kit-init.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  // a plugin update removes the recorded version: the shims run the newest x.y.z beside it, numerically
  const cache = join(tmp, "cache");
  for (const v of ["2.9.0", "2.10.1"]) {
    mkdirSync(join(cache, v, "githooks"), { recursive: true });
    for (const h of ["pre-commit", "commit-msg"]) writeFileSync(join(cache, v, "githooks", h), `echo ran ${v}\n`);
  }
  const shim = (h) => spawnSync("sh", [join(".githooks", h), "m"], { cwd: fresh, encoding: "utf8" });
  writeFileSync(join(fresh, ".git", "ai-kit-root"), join(cache, "2.3.0") + "\n");
  eq("shims: a removed version falls to the newest", [shim("pre-commit").stdout, shim("commit-msg").stdout], ["ran 2.10.1\n", "ran 2.10.1\n"]);
  writeFileSync(join(fresh, ".git", "ai-kit-root"), join(cache, "2.9.0") + "\n");
  eq("shims: a recorded version that exists runs", shim("commit-msg").stdout, "ran 2.9.0\n");
  writeFileSync(join(fresh, ".git", "ai-kit-root"), join(tmp, "nowhere", "2.3.0") + "\n");
  eq("commit-msg shim: a removed version with none beside it is warned", shim("commit-msg").stderr.includes("Job trailer not checked"), true);
  rmSync(join(fresh, ".git", "ai-kit-root"));
  eq("commit-msg shim: no path is warned, not silent", shim("commit-msg").stderr.includes("Job trailer not checked"), true);
  eq("check: current shims are not called older", run(fresh, "check").includes("older ai-kit shim"), false);
  const msgPath = join(fresh, ".githooks", "commit-msg");
  writeFileSync(msgPath, readFileSync(msgPath, "utf8").replace(/^echo "warn.*\n/m, ""), { mode: 0o755 });
  eq("check: an older commit-msg shim is named", run(fresh, "check").includes(".githooks/commit-msg is an older ai-kit shim"), true);
  run(fresh, "init");
  eq("init: rewrites the older shim", run(fresh, "check").includes("older ai-kit shim"), false);
  // a project's own commit-msg hook does not hide an older pre-commit shim; CRLF alone is not "older"
  const prePath = join(fresh, ".githooks", "pre-commit");
  const preText = readFileSync(prePath, "utf8");
  writeFileSync(msgPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(prePath, preText.replace(/^echo "warn.*\n/m, ""), { mode: 0o755 });
  eq("check: an older pre-commit shim is named beside an own commit-msg", run(fresh, "check").includes(".githooks/pre-commit is an older ai-kit shim"), true);
  writeFileSync(prePath, preText.replace(/\n/g, "\r\n"), { mode: 0o755 });
  eq("check: a CRLF copy of the current shim is not older", run(fresh, "check").includes("older ai-kit shim"), false);
  rmSync(msgPath);
  run(fresh, "init");
  // a shim without the execute bit is skipped by git: check reports it, init repairs it
  const hook = join(fresh, ".githooks", "pre-commit");
  chmodSync(hook, 0o644);
  eq("check: a non-executable shim is a problem", run(fresh, "check").includes(".githooks/pre-commit is not executable"), true);
  eq("init: makes the shim executable", [run(fresh, "init").includes("made executable"), (statSync(hook).mode & 0o111) !== 0], [true, true]);
  eq("check: no problem once executable", run(fresh, "check").includes("not executable"), false);
  // CLAUDE_CONFIG_DIR holds the user scope: a plugin enabled there counts
  const cfg = join(tmp, "cfg");
  mkdirSync(cfg);
  writeFileSync(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "ai-kit@korn9537": true } }));
  const withCfg = spawnSync("node", [SCRIPT, "check"], { cwd: fresh, encoding: "utf8", env: { ...process.env, HOME: fresh, CLAUDE_CONFIG_DIR: cfg } });
  eq("check: the plugin enabled under CLAUDE_CONFIG_DIR is found", withCfg.stdout.includes("the plugin is not enabled"), false);
  // ai/kit below the top of the repo never worked (git hooks resolve from the top): check fails loudly
  const mono = join(tmp, "mono");
  execFileSync("git", ["init", "-q", mono]);
  mkdirSync(join(mono, "app", "ai", "kit"), { recursive: true });
  writeFileSync(join(mono, "app", "ai", "kit", "config.json"), "{}");
  eq("check: from repo/app, the config under app/ai/kit is not found at the top", run(join(mono, "app"), "check").includes("ai/kit/config.json is missing"), true);
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
