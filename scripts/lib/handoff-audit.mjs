// The scan behind `usage.mjs handoffs`: per subagent, its brief and report, its reads before the first edit, and the
// parent's re-reads of paths the report named. Counts only: no brief or report text is printed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const PATH_RE = /(?:[A-Za-z]:)?\/?(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z][A-Za-z0-9]{0,5}(?::\d+(?:-\d+)?)?/g;
// the parent's calls looked at after a report: enough for the brief that follows, not the next task
const NEXT_CALLS = 15;

const rowsOf = (f) => readFileSync(f, "utf8").split("\n").flatMap((l) => {
  try {
    return l ? [JSON.parse(l)] : [];
  } catch {
    return [];
  }
});
const textOf = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.filter((p) => p?.type === "text").map((p) => p.text).join("\n") : "";
export const pathsOf = (s) => [...new Set(s.replace(/\\/g, "/").match(PATH_RE) || [])];
// the last folder and file of a path a report names: a command names it from the repo root or absolute
const tail = (p) => p.replace(/:\d+(-\d+)?$/, "").split("/").slice(-2).join("/");

export function roleOf(meta) {
  const t = meta?.agentType || "";
  const d = meta?.description || "";
  if (/committer/.test(t) || /^\s*commit:/i.test(d)) return "commit";
  if (/analyst/.test(t)) return "ba";
  if (/explor/i.test(t)) return "explore";
  if (/decider/.test(t)) return "decider";
  if (/reviewer/.test(t) || /review/i.test(d)) return "review";
  return "other";
}

export function kindOf(name, input) {
  if (/^(Edit|Write|NotebookEdit|MultiEdit)$/.test(name)) return "edit";
  if (name === "Read") return "read";
  if (name === "Grep" || name === "Glob") return "search";
  if (name !== "Bash") return "other";
  const c = String(input?.command || "").trim();
  // quoted text (a grep for "=> {", an awk "$1 > 5") is no redirect
  const bare = c.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''").replace(/\d?>>?\s*\/dev\/null|\d>&\d/g, "");
  if (/\bsed\s+-i|\btee\s|(^|[^0-9&>])>>?\s*[^&\s>]/.test(bare)) return "edit";
  if (/^(cat|sed\s+-n|head|tail|nl|awk)\b/.test(c)) return "read";
  if (/^(grep|rg|find|ls|git\s+grep|git\s+ls-files)\b/.test(c)) return "search";
  if (/^git\s+(log|show|diff|blame)\b/.test(c)) return "read";
  return "other";
}

const targetOf = (name, input) =>
  (name === "Bash" ? String(input?.command || "") : `${input?.file_path || ""} ${input?.pattern || ""} ${input?.path || ""}`).replace(/\\/g, "/");
const callsOf = (rows) => rows.filter((r) => r.type === "assistant").flatMap((r) =>
  (r.message?.content || []).filter((p) => p?.type === "tool_use").map((p) => ({ name: p.name, input: p.input })));
const looks = (c) => ["read", "search"].includes(kindOf(c.name, c.input));
const named = (c, set) => [...set].find((p) => p && targetOf(c.name, c.input).includes(p));

// one subagent: its transcript rows, meta, and the parent's rows (null when the parent file is gone)
export function auditAgent(rows, meta, parent, agentId) {
  const brief = textOf(rows.find((r) => r.type === "user")?.message?.content);
  // the report: a SubagentHandback call's message, else the last assistant text
  const said = (r) => {
    const back = (r.message?.content || []).find?.((p) => p?.type === "tool_use" && p.name === "SubagentHandback");
    return typeof back?.input?.message === "string" ? back.input.message : textOf(r.message?.content);
  };
  const last = [...rows].reverse().find((r) => r.type === "assistant" && said(r).trim());
  const report = last ? said(last) : "";
  const calls = callsOf(rows);
  const firstEdit = calls.findIndex((c) => kindOf(c.name, c.input) === "edit");
  const before = firstEdit < 0 ? calls : calls.slice(0, firstEdit);
  const briefPaths = pathsOf(brief);
  const out = {
    role: roleOf(meta), desc: String(meta?.description || "").slice(0, 60),
    briefChars: brief.length, briefPaths: briefPaths.length, ranged: briefPaths.some((p) => /:\d+/.test(p)),
    calls: calls.length, edits: firstEdit >= 0,
    searchesBeforeEdit: before.filter((c) => kindOf(c.name, c.input) === "search").length,
    readsBeforeEdit: before.filter((c) => kindOf(c.name, c.input) === "read").length,
    reportChars: report.length, reportPaths: pathsOf(report).length, parentSeen: false, reReads: [],
  };
  if (!parent) return out;
  // a background agent's report arrives as its task notification, a foreground one as the Agent tool_result; a
  // resumed agent completes again, and its last report goes with the last completion
  const done = (r) => {
    const s = textOf(r.message?.content) || JSON.stringify(r.message?.content ?? "");
    // the row's own first tags: a report quoting another agent's tag is not that agent's completion
    const id = s.match(/<task-id>([^<]*)<\/task-id>/)?.[1];
    if (agentId && id === agentId) return s.match(/<status>([^<]*)<\/status>/)?.[1] === "completed";
    return Array.isArray(r.message?.content) && r.message.content.some((p) => p?.type === "tool_result" &&
      p.tool_use_id === meta?.toolUseId) && !JSON.stringify(r.message.content).includes("Async agent launched");
  };
  const at = parent.findLastIndex((r) => r.type === "user" && done(r));
  if (at < 0) return out;
  out.parentSeen = true;
  const reported = new Set(pathsOf(report).map(tail));
  // the tool and the reported path only: a command line can carry a secret (a psql URL, a token)
  out.reReads = callsOf(parent.slice(at + 1)).slice(0, NEXT_CALLS).filter(looks)
    .map((c) => [c.name, named(c, reported)]).filter(([, p]) => p).map(([n, p]) => `${n}: ${p}`);
  return out;
}

// dir = one project's transcripts dir (usage-collect.mjs transcriptsDir); since = YYYY-MM-DD or ""
export function scanHandoffs(dir, { since = "" } = {}) {
  const sinceMs = since ? Date.parse(since) : -Infinity;
  const agents = [];
  const sessions = new Set();
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {}
  for (const e of entries) {
    const sub = join(dir, e.name, "subagents");
    if (!existsSync(sub)) continue;
    const parentFile = join(dir, `${e.name}.jsonl`);
    let parent;
    for (const m of readdirSync(sub).filter((f) => f.endsWith(".meta.json"))) {
      const mf = join(sub, m);
      const jf = mf.replace(/\.meta\.json$/, ".jsonl");
      try {
        if (statSync(mf).mtimeMs < sinceMs || !existsSync(jf)) continue;
        const meta = JSON.parse(readFileSync(mf, "utf8"));
        if (parent === undefined) parent = existsSync(parentFile) ? rowsOf(parentFile) : null;
        agents.push(auditAgent(rowsOf(jf), meta, parent, basename(jf).replace(/^agent-|\.jsonl$/g, "")));
        sessions.add(e.name);
      } catch {}
    }
  }
  return { since, sessions: sessions.size, agents };
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const mean = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : "-");
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function formatHandoffs(res, { examples = 5 } = {}) {
  const out = [`handoffs · sessions ${res.sessions} · subagents ${res.agents.length} · since ${res.since || "start"}`];
  const by = new Map();
  for (const a of res.agents) by.set(a.role, [...(by.get(a.role) || []), a]);
  const order = ["ba", "explore", "decider", "commit", "review", "other"].filter((r) => by.has(r));
  for (const r of order) {
    const a = by.get(r);
    const seen = a.filter((x) => x.parentSeen);
    const ed = a.filter((x) => x.edits);
    const line = [`${r}: ${a.length}`, `brief ${k(median(a.map((x) => x.briefChars)))} chars, ${pct(a.filter((x) => x.ranged).length, a.length)} with a line range`,
      `report ${k(median(a.map((x) => x.reportChars)))} chars`,
      `re-read after report ${mean(seen.map((x) => x.reReads.length))} calls/report, in ${pct(seen.filter((x) => x.reReads.length).length, seen.length)} of ${seen.length}`];
    if (ed.length) line.push(`before first edit ${mean(ed.map((x) => x.searchesBeforeEdit))} searches, ${mean(ed.map((x) => x.readsBeforeEdit))} reads`);
    out.push(line.join(" · "));
  }
  const worst = res.agents.filter((x) => x.reReads.length).sort((x, y) => y.reReads.length - x.reReads.length).slice(0, examples);
  for (const w of worst) out.push(`- ${w.role} "${w.desc}": ${w.reReads.length} re-reads, first ${w.reReads[0]}`);
  out.push("note: medians; a re-read is a parent read or search naming a path the report named, within its next 15 calls");
  return out.join("\n");
}
