// The kit's state folders under .git (twin of kit_state_dir in hooks/lib.sh; contents: docs/spec.md, files the kit
// creates). Each takes git's cwd and returns "" when git fails; options { timeout } ms (default none), { throws: true }
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const git = (cwd, args, { timeout, throws } = {}) => {
  try {
    return execFileSync("git", args, { windowsHide: true, cwd, encoding: "utf8", ...(timeout ? { timeout } : {}), stdio: ["ignore", "pipe", "pipe"] }).trim();
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
export const planRunDir = (root, o) => under(commonDir(root, o), "claude-plan-run");
