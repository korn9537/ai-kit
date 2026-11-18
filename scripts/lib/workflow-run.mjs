// A workflow's run: its run file and how long its agents have been quiet; shared by continuous.mjs and plan.mjs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

// <session>/subagents/workflows/<runId> → <session>/workflows/<runId>.json; only `completed` is known to end a run,
// so any other status counts as running until nothing has moved for HUNG_AFTER
export function readRun(dir, since = 0, now = Date.now()) {
  let run = {};
  try {
    run = read(join(dir, "..", "..", "..", "workflows", `${basename(dir)}.json`));
  } catch {
    // not written yet
  }
  let last = since;
  try {
    for (const f of readdirSync(dir)) last = Math.max(last, statSync(join(dir, f)).mtimeMs);
  } catch {
    // no agent wrote yet
  }
  return { ...run, idle: now - last };
}
