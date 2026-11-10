// The kit's state folders under .git, one place for the paths (twin of kit_state_dir in hooks/lib.sh).
// Each takes the directory git runs from and returns "" when git fails, so a caller's empty check still works.
// Options: { timeout } in ms (none by default, the old decider and plan calls had none); { throws: true } lets git's own error out.
//   reviewDir      <absolute-git-dir>/claude-review   per work tree: review snapshots, read counts, run state
//   usageCacheDir  <absolute-git-dir>/claude-usage    per work tree: transcript cache <session>.json
//   usageBufDir    <git-common-dir>/claude-usage      shared: buffer <session>.jsonl, .flushed, locks
//   deciderDir     <git-common-dir>/claude-decider    shared: used verdicts <session>.json
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const git = (cwd, args, { timeout, throws } = {}) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", ...(timeout ? { timeout } : {}), stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    if (throws) throw e;
    return "";
  }
};
const under = (base, name) => (base ? join(base, name) : "");
const gitDir = (root, o) => git(root, ["rev-parse", "--absolute-git-dir"], o);
const commonDir = (root, o) => git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], o);

export const reviewDir = (root, o) => under(gitDir(root, o), "claude-review");
export const usageCacheDir = (root, o) => under(gitDir(root, o), "claude-usage");
export const usageBufDir = (root, o) => under(commonDir(root, o), "claude-usage");
export const deciderDir = (root, o) => under(commonDir(root, o), "claude-decider");
