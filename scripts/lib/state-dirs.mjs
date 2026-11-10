// The kit's state folders under .git, one place for the paths (twin of kit_state_dir in hooks/lib.sh).
// Each takes the directory git runs from and returns "" when git fails, so a caller's empty check still works.
//   reviewDir      <absolute-git-dir>/claude-review   per work tree: review snapshots, read counts, run state
//   usageCacheDir  <absolute-git-dir>/claude-usage    per work tree: transcript cache <session>.json
//   usageBufDir    <git-common-dir>/claude-usage      shared: buffer <session>.jsonl, .flushed, locks
//   deciderDir     <git-common-dir>/claude-decider    shared: used verdicts <session>.json
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const git = (cwd, ...args) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const under = (base, name) => (base ? join(base, name) : "");
const gitDir = (root) => git(root, "rev-parse", "--absolute-git-dir");
const commonDir = (root) => git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");

export const reviewDir = (root) => under(gitDir(root), "claude-review");
export const usageCacheDir = (root) => under(gitDir(root), "claude-usage");
export const usageBufDir = (root) => under(commonDir(root), "claude-usage");
export const deciderDir = (root) => under(commonDir(root), "claude-decider");
