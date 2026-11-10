// Tests for scripts/lib/state-dirs.mjs and kit_state_dir in hooks/lib.sh: both print the same four folders, in the
// main work tree (from a subfolder) and in a linked one, equal to the literal git paths; empty outside a repo.
// Usage: node scripts/state-dirs.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deciderDir, reviewDir, usageBufDir, usageCacheDir } from "./lib/state-dirs.mjs";

let failed = 0;
function eq(desc, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? `ok   - ${desc}` : `FAIL - ${desc}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
}

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(kitRoot, "hooks", "lib.sh");
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const bash = (dir, kind) =>
  spawnSync("bash", ["-c", `source "${lib}"; kit_state_dir ${kind} "$1"`, "x", dir], { encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: "" } });
const KINDS = ["review", "usage-cache", "usage", "decider"];
const nodeDirs = (d) => [reviewDir(d), usageCacheDir(d), usageBufDir(d), deciderDir(d)];
const literal = (d) => {
  const own = git(d, "rev-parse", "--absolute-git-dir");
  const common = git(d, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return [`${own}/claude-review`, `${own}/claude-usage`, `${common}/claude-usage`, `${common}/claude-decider`];
};

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "state-dirs-")));
try {
  const repo = join(tmp, "repo");
  mkdirSync(join(repo, "sub"), { recursive: true });
  mkdirSync(join(repo, "ai", "kit"), { recursive: true });
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@t");
  git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  const wt = join(tmp, "wt");
  git(repo, "worktree", "add", "-q", wt, "-b", "other");

  const where = { "main work tree, from a subfolder": join(repo, "sub"), "linked work tree": wt };
  const results = {};
  for (const [name, dir] of Object.entries(where)) {
    const n = nodeDirs(dir);
    const b = KINDS.map((k) => bash(dir, k).stdout.trim());
    results[name] = n;
    eq(`${name}: node equals the literal git paths`, n, literal(dir));
    eq(`${name}: bash equals node`, b, n);
  }
  const [m, w] = Object.values(results);
  eq("review and usage-cache differ per work tree", [m[0] !== w[0], m[1] !== w[1]], [true, true]);
  eq("usage and decider are shared", [m[2] === w[2], m[3] === w[3]], [true, true]);

  const none = join(tmp, "none");
  mkdirSync(none);
  eq("outside a repo: node helpers return empty", nodeDirs(none), ["", "", "", ""]);
  const outs = KINDS.map((k) => bash(none, k));
  eq("outside a repo: bash prints nothing and fails", outs.map((o) => [o.stdout, o.status !== 0]), KINDS.map(() => ["", true]));
  eq("bash: an unknown kind fails", bash(repo, "nope").status !== 0, true);

  // a hook runs git from the input cwd, not $PWD, when CLAUDE_PROJECT_DIR is unset
  const other = join(tmp, "other");
  mkdirSync(join(other, "ai", "kit"), { recursive: true });
  git(other, "init", "-q");
  const input = JSON.stringify({ session_id: "s1", cwd: other, tool_name: "Agent", tool_input: { subagent_type: "change-reviewer" } });
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync("bash", [join(kitRoot, "hooks", "review-snapshot.sh")], { cwd: repo, input, env, encoding: "utf8" });
  eq("review-snapshot: exits 0", r.status, 0);
  eq("review-snapshot: writes in the input cwd's repo", existsSync(join(other, ".git", "claude-review", "s1")), true);
  eq("review-snapshot: not in the PWD repo", existsSync(join(repo, ".git", "claude-review", "s1")), false);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
