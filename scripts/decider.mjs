#!/usr/bin/env node
// Decision log CLI. Verdicts are read from each ai-kit:decider subagent's own transcript
// (<session>/subagents/agent-<id>.jsonl beside the session transcript), so a background call counts as a foreground
// one. `sync` (SubagentStop, Stop) writes a finished decider's verdict blocks once to
// ai/usage/decisions/<YYYY-MM>/<session>.<agent>.jsonl. `guard` (ask-guard.sh) syncs, then prints owner, decided,
// pending or none for the newest unused decider of the last 30 minutes; owner marks it used. `report [--since
// YYYY-MM-DD]` prints the log as markdown. Never fails: an error is one stderr line.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIELDS = ["verdict", "kind", "question", "choice", "reason", "confidence", "undo", "sources"];
const MAX_FIELD = 500;
const FRESH_MS = 30 * 60 * 1000;

const git = (cwd, ...args) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

// As hooks/lib.sh kit_project_root (usage.mjs runs its CLI on import, so not shared from there).
function projectRoot(dir) {
  let d = (dir || "/").replace(/\/+$/, "") || "/";
  if (existsSync(join(d, "ai", "kit"))) return d;
  const prefix = (git(d, "rev-parse", "--show-prefix") ?? "").replace(/\/+$/, "");
  if (prefix && d.endsWith(`/${prefix}`)) d = d.slice(0, -(prefix.length + 1));
  return d || "/";
}

// One record per `Verdict:` line; the lines after it fill its fields until the next `Verdict:`.
export function parseBlocks(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const m = /^\s*(?:\*\*)?([A-Za-z]+)(?:\*\*)?\s*:\s*(?:\*\*\s*)?(.*?)\s*$/.exec(raw);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (!FIELDS.includes(key)) continue;
    if (key === "verdict") {
      const v = m[2].toUpperCase().replace(/[^A-Z]/g, "");
      if (v !== "DECIDED" && v !== "OWNER") continue;
      cur = { verdict: v };
      out.push(cur);
    } else if (cur && !(key in cur)) {
      cur[key] = m[2].slice(0, MAX_FIELD);
    }
  }
  return out;
}

// The session's subagents dir, from the session transcript or from a subagent's own (SubagentStop may give either).
export function subagentsDir(transcript) {
  if (!transcript) return "";
  if (basename(dirname(transcript)) === "subagents") return dirname(transcript);
  return join(transcript.replace(/\.jsonl$/, ""), "subagents");
}

// Every decider subagent of the session: id, the text and time of its last assistant message, its verdict blocks.
export function deciders(dir) {
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".meta.json"));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    let meta = {};
    try {
      meta = JSON.parse(readFileSync(join(dir, n), "utf8"));
    } catch {
      continue;
    }
    if (!/(^|:)decider$/.test(meta.agentType ?? "")) continue;
    const id = n.slice(0, -".meta.json".length).replace(/^agent-/, "");
    const path = join(dir, `agent-${id}.jsonl`);
    let text = "";
    let ts = "";
    let lines = [];
    try {
      lines = readFileSync(path, "utf8").split("\n");
    } catch {}
    for (const l of lines) {
      let e;
      try {
        e = l && JSON.parse(l);
      } catch {
        continue;
      }
      if (e?.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
      // the final reply is a text block, or the message of a SubagentHandback call where the harness has one
      const t = e.message.content
        .map((c) => (c?.type === "text" ? c.text : c?.type === "tool_use" && /handback/i.test(c.name ?? "") ? c.input?.message : null))
        .filter((x) => typeof x === "string");
      if (t.length) {
        text = t.join("\n");
        ts = typeof e.timestamp === "string" ? e.timestamp : "";
      }
    }
    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {}
    out.push({ id, ts: ts || new Date(mtime).toISOString(), mtime, blocks: parseBlocks(text) });
  }
  return out.sort((a, b) => a.mtime - b.mtime);
}

// One file per decider call, written once: no two branches, worktrees or machines write the same name differently.
export function logDeciders(root, session, list) {
  for (const d of list) {
    if (d.blocks.length === 0) continue;
    const dir = join(root, "ai", "usage", "decisions", d.ts.slice(0, 7));
    const path = join(dir, `${session}.${d.id}.jsonl`);
    if (existsSync(path)) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, d.blocks.map((b) => JSON.stringify({ ts: d.ts, session, agent: d.id, ...b }) + "\n").join(""));
  }
}

function context(input) {
  const session = input.session_id;
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || input.cwd);
  if (!session || !input.transcript_path || !existsSync(join(root, "ai", "kit"))) return null;
  return { session, root, list: deciders(subagentsDir(input.transcript_path)) };
}

export function sync(input) {
  const c = context(input);
  if (c) logDeciders(c.root, c.session, c.list);
}

// owner: an unused call of the last 30 minutes has an OWNER block (the newest such call is now used up) · else the
// newest unused call decides: pending = no verdict lines yet (running, or it replied without them), decided = only
// DECIDED blocks · none: no unused call. Without a git dir to keep the used list in, owner is never used up. Gap: a
// decider continued by SendMessage keeps its id, so its later verdicts are neither logged nor counted once used.
export function guard(input, now = Date.now()) {
  const c = context(input);
  if (!c) return "owner";
  logDeciders(c.root, c.session, c.list);
  const common = git(c.root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const statePath = common ? join(common, "claude-decider", `${c.session}.json`) : "";
  let used = [];
  try {
    used = JSON.parse(readFileSync(statePath, "utf8")).used ?? [];
  } catch {}
  const fresh = c.list.filter((d) => now - d.mtime <= FRESH_MS && !used.includes(d.id));
  const owner = fresh.filter((d) => d.blocks.some((b) => b.verdict === "OWNER")).at(-1);
  if (!owner) {
    const last = fresh.at(-1);
    return !last ? "none" : last.blocks.length === 0 ? "pending" : "decided";
  }
  if (statePath) {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ used: [...used, owner.id] }) + "\n");
  }
  return "owner";
}

export function loadDecisions(root, since = "") {
  const base = join(root, "ai", "usage", "decisions");
  let files = [];
  try {
    files = readdirSync(base, { recursive: true }).map(String).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    let text = "";
    try {
      text = readFileSync(join(base, f), "utf8");
    } catch {
      continue;
    }
    for (const l of text.split("\n")) {
      try {
        const r = l && JSON.parse(l);
        if (r && typeof r.ts === "string" && r.verdict && r.ts.slice(0, 10) >= since) out.push(r);
      } catch {}
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "-";

export function report(recs, since = "") {
  if (recs.length === 0) return since ? `no decisions since ${since}\n` : "no decisions logged\n";
  const decided = recs.filter((r) => r.verdict === "DECIDED");
  const owner = recs.filter((r) => r.verdict === "OWNER");
  const low = decided.filter((r) => /low/i.test(r.confidence ?? ""));
  const lines = [
    `# Decisions${since ? ` since ${since}` : ""}`,
    "",
    `${recs.length} questions: ${decided.length} decided by the agent (${low.length} low confidence), ` +
      `${owner.length} sent to the owner.`,
  ];
  const table = (title, rows, owners) => {
    if (rows.length === 0) return;
    lines.push("", `## ${title}`, "");
    lines.push(owners ? "| When | Kind | Question | Recommended | Reason |" : "| When | Question | Choice | Conf. | Reason | Undo | Sources |");
    lines.push(owners ? "|---|---|---|---|---|" : "|---|---|---|---|---|---|---|");
    for (const r of rows) {
      const when = `${r.ts.slice(0, 10)} ${r.ts.slice(11, 16)}`;
      lines.push(
        owners
          ? `| ${when} | ${cell(r.kind)} | ${cell(r.question)} | ${cell(r.choice)} | ${cell(r.reason)} |`
          : `| ${when} | ${cell(r.question)} | ${cell(r.choice)} | ${cell(r.confidence)} | ${cell(r.reason)} | ${cell(r.undo)} | ${cell(r.sources)} |`,
      );
    }
  };
  table("Low confidence, check these first", low, false);
  table("Decided by the agent", decided.filter((r) => !low.includes(r)), false);
  table("Sent to the owner", owner, true);
  return lines.join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const stdin = () => {
    try {
      return JSON.parse(readFileSync(0, "utf8"));
    } catch {
      return {};
    }
  };
  try {
    if (cmd === "sync") {
      sync(stdin());
    } else if (cmd === "guard") {
      process.stdout.write(`${guard(stdin())}\n`);
    } else if (cmd === "report") {
      const i = args.indexOf("--since");
      const since = i >= 0 ? (args[i + 1] ?? "") : "";
      if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("--since takes YYYY-MM-DD");
      const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
      process.stdout.write(report(loadDecisions(root, since), since));
    } else {
      throw new Error("usage: decider.mjs sync | guard | report [--since YYYY-MM-DD]");
    }
  } catch (e) {
    console.error(`decider: ${e.message}`);
    // the guard fails open: a broken log must not trap the owner's answer
    if (cmd === "guard") process.stdout.write("owner\n");
  }
}
