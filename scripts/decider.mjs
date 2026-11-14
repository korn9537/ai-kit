#!/usr/bin/env node
// Decision log CLI. Verdicts are read from each ai-kit:decider subagent's own transcript
// (<session>/subagents/agent-<id>.jsonl beside the session transcript), so a background call counts as a foreground
// one. `sync` (SubagentStop, Stop) writes a finished decider's verdict blocks once to
// <git-common-dir>/claude-decider/log/<session>.<agent>.jsonl, which `usage.mjs send` posts; on SubagentStop from the
// hook's agent_id and last_assistant_message. `guard` (ask-guard.sh) matches each asked question to a verdict block of
// the last 30 minutes and prints owner, decided, pending, unmatched or none, then one detail line per question; owner
// marks those blocks used. `report [--since YYYY-MM-DD]` prints the usage API's log of this project plus the unsent
// ones as markdown. Never fails: an error is one stderr line.
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { deciderDir } from "./lib/state-dirs.mjs";
import { endpointOf, getAll, projectId } from "./lib/usage-api.mjs";

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

// As hooks/lib.sh kit_project_root (usage.mjs keeps its own copy).
function projectRoot(dir) {
  let d = (dir || "/").replace(/\\/g, "/").replace(/\/+$/, "") || "/";
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

// ai-kit:decider, or the general-purpose fallback when that type is not loaded (description names the decider)
const isDecider = (type, description = "") =>
  /(^|:)decider$/.test(type) || ((type === "" || type === "general-purpose") && /decider/i.test(description));

// Every decider subagent of the session: id, the text and time of its last assistant message, its verdict blocks,
// done (the last assistant line hands back or ends the turn with no tool call).
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
    if (!isDecider(meta.agentType ?? "", meta.description ?? "")) continue;
    const id = n.slice(0, -".meta.json".length).replace(/^agent-/, "");
    const path = join(dir, `agent-${id}.jsonl`);
    let text = "";
    let ts = "";
    let done = false;
    let quiet = false;
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
      const tools = e.message.content.filter((c) => c?.type === "tool_use").map((c) => c.name ?? "");
      done = (tools.length === 1 && /handback/i.test(tools[0])) || (tools.length === 0 && e.message.stop_reason === "end_turn");
      quiet = tools.length === 0 && e.message.stop_reason == null;
      // the final reply is a text block, or the message of a SubagentHandback call where the harness has one
      const t = e.message.content
        .map((c) => (c?.type === "text" ? c.text : c?.type === "tool_use" && /handback/i.test(c.name ?? "") ? c.input?.message : null))
        .filter((x) => typeof x === "string");
      if (t.length) {
        text = t.join("\n");
        ts = typeof e.timestamp === "string" ? e.timestamp : "";
      }
    }
    // no transcript yet: a call that just started, so its meta file's time stands in; 0 would drop it from the guard's
    // fresh list and let a second decider start
    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      try {
        mtime = statSync(join(dir, n)).mtimeMs;
      } catch {}
    }
    // a text reply with no stop_reason (some transcripts) is final once the file has been idle for a minute
    if (quiet && Date.now() - mtime > 60000) done = true;
    out.push({ id, ts: ts || new Date(mtime).toISOString(), mtime, done, blocks: parseBlocks(text) });
  }
  return out.sort((a, b) => a.mtime - b.mtime);
}

// The decider log until `usage.mjs send` posts it; a sent file leaves <session>.<agent>.sent behind.
const logDir = (root) => {
  const d = deciderDir(root);
  return d ? join(d, "log") : "";
};

// One file per finished decider call, never again once sent or rejected. Written whole to a tmp file and hard-linked
// to its name, which fails if it exists (SubagentStop and Stop may race), so a send never reads a half-written file.
function logDeciders(root, session, list) {
  const dir = logDir(root);
  if (!dir) return;
  for (const d of list) {
    if (!d.done || d.blocks.length === 0) continue;
    const path = join(dir, `${session}.${d.id}.jsonl`);
    if (existsSync(path) || existsSync(`${path}.rejected`) || existsSync(join(dir, `${session}.${d.id}.sent`))) continue;
    mkdirSync(dir, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, d.blocks.map((b) => JSON.stringify({ ts: d.ts, session, agent: d.id, ...b }) + "\n").join(""));
    try {
      linkSync(tmp, path);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    } finally {
      unlinkSync(tmp);
    }
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
  if (!c) return;
  // SubagentStop names the call that just ended and carries its final reply; a handback reply may leave it empty
  const id = typeof input.agent_id === "string" ? input.agent_id : "";
  if (id && typeof input.last_assistant_message === "string") {
    let d = c.list.find((x) => x.id === id);
    if (!d && isDecider(input.agent_type ?? "")) {
      d = { id, ts: new Date().toISOString(), mtime: Date.now(), blocks: [] };
      c.list.push(d);
    }
    if (d) {
      const blocks = parseBlocks(input.last_assistant_message);
      Object.assign(d, { done: true }, blocks.length ? { blocks } : {});
    }
  }
  logDeciders(c.root, c.session, c.list);
}

// Words that carry no topic: "which"/"should"/"use" match every question, so a verdict on one question would pass
// another that shares only them. Latin-script words only.
const STOP = new Set(
  ("a an the of to for in on at by or and is are be it its this that these those which what who how do does should would " +
    "can could we you i our your use used using with as from if then than so not no yes into about one").split(" "),
);
// Scripts written without spaces between words: a run is compared by its character bigrams, not as one token.
const UNSPACED = /[\p{Script=Thai}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

// Comparable features of a question: lowercase words of Unicode letters, marks (Thai vowels and tones are \p{M}) and
// digits, without stop words; a word in an unspaced script contributes its character bigrams.
export function features(text) {
  const out = new Set();
  for (const w of String(text ?? "").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []) {
    if (UNSPACED.test(w)) {
      const ch = [...w];
      if (ch.length === 1) out.add(w);
      for (let i = 0; i + 1 < ch.length; i++) out.add(ch[i] + ch[i + 1]);
    } else if (!STOP.has(w)) out.add(w);
  }
  return out;
}

// Shared features over the smaller side. A match needs MATCH_MIN of it: the decider restates a question in its own
// words, so most of the shorter text must reappear, but one shared word out of two stays a miss (that is "which
// order?" against "which database?" once stop words are gone, and any single common word out of a long question).
// Tested with a rephrased English pair and a rephrased Thai pair against unrelated ones.
const MATCH_MIN = 0.5;
export function overlap(a, b) {
  const x = features(a);
  const y = features(b);
  if (x.size === 0 || y.size === 0) return 0;
  let n = 0;
  for (const f of x) if (y.has(f)) n++;
  return n / Math.min(x.size, y.size);
}

const askedQuestions = (input) =>
  (Array.isArray(input.tool_input?.questions) ? input.tool_input.questions : [])
    .map((q) => [q?.question, q?.header].filter((s) => typeof s === "string").join(" "))
    .filter((s) => s.trim());

// A lock directory beside the state file serialises the read-match-write: two parallel AskUserQuestion calls would
// otherwise both read the same used list and spend one block twice. A lock older than 10 s is stale (a crashed
// hook); not getting it in 2 s runs unlocked, as before, rather than trap the owner's answer.
function withStateLock(dir, fn) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, ".lock");
  const end = Date.now() + 2000;
  let held = false;
  for (;;) {
    try {
      mkdirSync(lock);
      held = true;
      break;
    } catch (e) {
      if (e?.code !== "EEXIST") break;
    }
    try {
      if (Date.now() - statSync(lock).mtimeMs > 10000) rmSync(lock, { recursive: true, force: true });
    } catch {}
    if (Date.now() >= end) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  try {
    return fn();
  } finally {
    if (held) rmSync(lock, { recursive: true, force: true });
  }
}

// state: {used: [call ids spent whole (the older format, still read)], blocks: ["<call id>#<block index>"]}
function readState(path) {
  try {
    const s = JSON.parse(readFileSync(path, "utf8"));
    return { used: Array.isArray(s.used) ? s.used : [], blocks: Array.isArray(s.blocks) ? s.blocks : [] };
  } catch {
    return { used: [], blocks: [] };
  }
}

function writeState(path, s) {
  mkdirSync(dirname(path), { recursive: true });
  // tmp and rename: a torn file would read as no used list, and an owner verdict would count again
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s) + "\n");
  renameSync(tmp, path);
}

// What the ask-guard needs: {state, detail}. Each asked question (tool_input.questions[].question and header) takes
// the best matching block of the unused decider calls of the last 30 minutes, an OWNER block before a DECIDED one,
// and a block serves one question once ("<call id>#<index>" kept as used).
//   owner     every question has an OWNER block (all of them are now used up)
//   pending   a question has none and the newest call has no verdict lines yet (running, or replied without them)
//   decided   a question matches a DECIDED block; detail: one "Question => Choice" line each
//   unmatched a question matches no block; detail: one line each
//   none      no unused call at all
// An ask with no questions in its input falls back to the old rule: the newest unused call with an OWNER block
// serves it whole. Without a git dir to keep the used list in, owner is never used up. Gap: a decider continued by
// SendMessage keeps its id, so its later verdicts are neither logged nor counted once used.
export function check(input, now = Date.now()) {
  const c = context(input);
  if (!c) return { state: "owner", detail: [] };
  const stateDir = deciderDir(c.root);
  const statePath = stateDir ? join(stateDir, `${c.session}.json`) : "";
  const asked = askedQuestions(input);
  const run = () => {
    const st = statePath ? readState(statePath) : { used: [], blocks: [] };
    const fresh = c.list.filter((d) => now - d.mtime <= FRESH_MS && !st.used.includes(d.id));
    const last = fresh.at(-1);
    const pending = !!last && last.blocks.length === 0;
    const spend = (keys, ids) => {
      if (statePath) writeState(statePath, { used: [...st.used, ...ids], blocks: [...st.blocks, ...keys] });
    };
    if (asked.length === 0) {
      const owner = fresh.filter((d) => d.blocks.some((b) => b.verdict === "OWNER")).at(-1);
      if (!owner) return { state: !last ? "none" : pending ? "pending" : "decided", detail: [] };
      spend([], [owner.id]);
      return { state: "owner", detail: [] };
    }
    const cands = fresh.flatMap((d) => d.blocks.map((b, i) => ({ key: `${d.id}#${i}`, b })).filter((x) => !st.blocks.includes(x.key)));
    const taken = new Set();
    const unmatched = [];
    const decided = [];
    for (const q of asked) {
      let best = null;
      for (const x of cands) {
        if (taken.has(x.key)) continue;
        const s = overlap(q, x.b.question);
        if (s < MATCH_MIN) continue;
        const rank = (x.b.verdict === "OWNER" ? 2 : 0) + s / 2;
        if (!best || rank > best.rank) best = { ...x, rank };
      }
      if (!best) unmatched.push(q);
      else {
        taken.add(best.key);
        if (best.b.verdict !== "OWNER") decided.push(`${q} => ${best.b.choice ?? "(no Choice line)"}`);
      }
    }
    if (unmatched.length === 0 && decided.length === 0) {
      spend([...taken], []);
      return { state: "owner", detail: [] };
    }
    if (pending) return { state: "pending", detail: [] };
    if (decided.length) return { state: "decided", detail: decided };
    return { state: cands.length || pending ? "unmatched" : "none", detail: unmatched };
  };
  return statePath ? withStateLock(stateDir, run) : run();
}

export const guard = (input, now = Date.now()) => check(input, now).state;

// The local log files not sent yet.
export function loadDecisions(root, since = "") {
  const base = logDir(root);
  let files = [];
  try {
    files = readdirSync(base).filter((f) => f.endsWith(".jsonl"));
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
    // seq: the line's index, as usage-send's sendDecisions numbers it
    let seq = 0;
    for (const l of text.split("\n")) {
      if (!l.trim()) continue;
      const i = seq++;
      try {
        const r = JSON.parse(l);
        if (r && typeof r.ts === "string" && r.verdict && r.ts.slice(0, 10) >= since) out.push({ ...r, seq: i });
      } catch {}
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

function readConfig(root) {
  try {
    return JSON.parse(readFileSync(join(root, "ai", "kit", "config.json"), "utf8"));
  } catch {
    return {};
  }
}

// The usage API's decisions of this project plus the local ones not sent yet, once each (session, agent, seq);
// error is the API's one-line failure, the local ones are still returned.
export async function loadAllDecisions(root, since = "") {
  const local = loadDecisions(root, since);
  const conf = readConfig(root).usage ?? {};
  if (conf.enabled === false) return { recs: local, error: "" };
  let rows = [];
  try {
    rows = await getAll(endpointOf(conf), "/v1/decisions", { project: projectId(root), since });
  } catch (e) {
    return { recs: local, error: e.message };
  }
  const recs = rows.map(({ session_id, agent_id, seq, project, extra, ...r }) => ({ ...(extra ?? {}), ...r, session: session_id, agent: agent_id, seq }))
    .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)));
  const seen = new Set(recs.map((r) => `${r.session}\n${r.agent}\n${r.seq}`));
  for (const r of local) if (!seen.has(`${r.session}\n${r.agent}\n${r.seq}`)) recs.push(r);
  return { recs: recs.sort((a, b) => a.ts.localeCompare(b.ts)), error: "" };
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

if (isMain(import.meta.url)) {
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
      const r = check(stdin());
      process.stdout.write(`${[r.state, ...r.detail.map((l) => l.replace(/\s+/g, " "))].join("\n")}\n`);
    } else if (cmd === "report") {
      const i = args.indexOf("--since");
      const since = i >= 0 ? (args[i + 1] ?? "") : "";
      if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("--since takes YYYY-MM-DD");
      const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
      const { recs, error } = await loadAllDecisions(root, since);
      if (error) console.error(`decider: ${error}; showing the decisions not sent yet only`);
      process.stdout.write(report(recs, since));
    } else {
      throw new Error("usage: decider.mjs sync | guard | report [--since YYYY-MM-DD]");
    }
  } catch (e) {
    console.error(`decider: ${e.message}`);
    // the guard fails open: a broken log must not trap the owner's answer
    if (cmd === "guard") process.stdout.write("owner\n");
  }
}
