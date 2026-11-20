// plan.mjs live: one line per batch of a running run-plan workflow, read from its transcript dir.
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const IDLE_MIN = 15;

const short = (h) => (h || "").slice(0, 7);
const mtime = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

// Git Bash hands Node on Windows /c/Users/...; Node needs C:/Users/... (as hooks/lib.sh kit_path)
export const nodePath = (p, platform = process.platform) =>
  platform === "win32" ? p.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:") : p;

// label → { key, title, step }; a label run-plan.js does not set is its own key and title
export function parseLabel(label) {
  const m = /^(commit|review): \[([^\]\s]+)(?: (fix|recheck))?\] (.*)$/.exec(label || "");
  const step = m && (m[3] ? (m[1] === "commit") === (m[3] === "fix") && m[3] : m[1]);
  if (!step) return { key: label || "(no label)", title: label || "(no label)", step: "agent" };
  return { key: m[2], title: m[4], step };
}

function agentDone(step, raw) {
  let r = raw;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {}
  }
  if (r === null || r === undefined) return `${step} failed or skipped`;
  if (typeof r !== "object") return `${step} done`;
  if (step === "commit" || step === "fix") {
    if (!r.hash) return `${step}: not committed${r.blockers?.length ? ` (${r.blockers[0]})` : ""}`;
    const open = [...(r.owner || []).map((o) => `owner: ${o}`), ...(r.blockers || []).map((b) => `blocker: ${b}`)];
    const skip = step === "commit" && r.review === "skip" ? " · review skipped, move-only or comment-only" : "";
    return `${step} ${short(r.hash)}${open.length ? ` ⚠ ${open.join("; ")}` : ""}${skip}`;
  }
  if (step === "review" || step === "recheck") {
    if (!r.reviewed) return `${step}: not reviewed${r.checked ? ` (${r.checked})` : ""}`;
    const c = (r.findings || []).filter((f) => f.verdict === "CONFIRMED").length;
    const p = (r.findings || []).length - c;
    return c || p ? `${step} ${c} CONFIRMED, ${p} PLAUSIBLE` : `${step} clean`;
  }
  return `${step} done`;
}

// one line per batch id and one `job` line for the job review, from run-plan.js's agent labels (parseLabel)
// where: the workflow transcript dir (journal.jsonl, agent-<id>.jsonl); now: ms, for the idle time of running agents
export function liveStatus(where, now) {
  const dir = resolve(where);
  const journal = join(dir, "journal.jsonl");
  const events = readFileSync(journal, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const agents = new Map();
  for (const e of events) {
    if (e.type === "started" && e.agentId) agents.set(e.agentId, { ...parseLabel(e.label), id: e.agentId, running: true });
    if (e.type === "result" && agents.has(e.agentId)) Object.assign(agents.get(e.agentId), { running: false, result: e.result });
  }
  // <session>/subagents/workflows/<runId> → <session>/workflows/<runId>.json, holding the run's status
  const run = join(dirname(dirname(dirname(dir))), "workflows", `${basename(dir)}.json`);
  let state = "";
  try {
    state = JSON.parse(readFileSync(run, "utf8")).status || "";
  } catch {}
  const over = state && state !== "running";
  const batches = new Map();
  let running = 0;
  for (const a of agents.values()) {
    let text;
    if (a.running && over) text = `${a.step} stopped, no result`;
    else if (a.running) {
      running++;
      const idle = Math.max(0, Math.round((now - (mtime(join(dir, `agent-${a.id}.jsonl`)) || now)) / 60000));
      text = idle >= IDLE_MIN ? `${a.step} ⚠ no transcript write for ${idle}m` : `${a.step} running`;
    } else text = agentDone(a.step, a.result);
    if (!batches.has(a.key)) batches.set(a.key, { title: a.title, steps: [] });
    batches.get(a.key).steps.push(text);
  }
  const finished = [...agents.values()].filter((a) => !a.running).length;
  const lines = [`${basename(dir)}: ${state || (running ? "running" : "no agent running")}, ${finished} agent(s) done, ${running} running`];
  for (const [key, b] of batches) lines.push(`${key === b.title ? key : `${key} ${b.title}`}: ${b.steps.join(" · ")}`);
  return lines;
}
