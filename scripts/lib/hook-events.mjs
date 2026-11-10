// Counts the kit hooks' firings in one project's Claude Code transcripts. HOOK_EVENTS is the one table: a hook
// message edited without its entry counts 0 silently, so scripts/usage-hooks.test.mjs checks `anchor` against `file`.
// A kit version whose hook text differed from this table is undercounted: `no firing` is not proof of no use.
import { createReadStream, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, sep } from "node:path";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// src: pre = PreToolUse error result; block = hook_blocking_error attachment (fallback: txt); note = context attachment;
// git = Bash result of a git commit. event = the attachment's hookEvent.
const m = (id, file, src, anchor, sample, re = new RegExp(esc(anchor)), event = "") => ({ id, file, src, event, anchor, sample, re });
const stop = (id, anchor, sample) => m(id, "hooks/review-before-stop.sh", "block", anchor, sample, new RegExp(`^\\s*${esc(anchor)}`), "Stop");
const BG = "hooks/bash-guard.sh";
const PC = "githooks/pre-commit";

export const HOOK_EVENTS = [
  m("bash-guard.staging", BG, "pre", "Blocked: a sweeping stage", "Blocked: a sweeping stage (git add -A/-u/./a directory)."),
  m("bash-guard.build", BG, "pre", "is listening (the user's dev server)", "Blocked: :3000 is listening (the user's dev server).",
    /is listening \(the user's dev server\)/),
  m("memory-guard", "hooks/lib.sh", "pre", "Blocked: auto-memory", "Blocked: auto-memory (~/.claude/projects/*/memory/) is on this machine only"),
  m("agent-model-guard", "hooks/agent-model-guard.sh", "pre", "Blocked: a general-purpose or Explore subagent without a model",
    "Blocked: a general-purpose or Explore subagent without a model inherits the main session's model"),
  m("ask-guard.none", "hooks/ask-guard.sh", "pre", "Blocked: the agent decides; the owner holds only", "Blocked: the agent decides; the owner holds only the four owner kinds"),
  m("ask-guard.decided", "hooks/ask-guard.sh", "pre", "Blocked: the last ai-kit:decider call decided this", "Blocked: the last ai-kit:decider call decided this (DECIDED)"),
  m("ask-guard.pending", "hooks/ask-guard.sh", "pre", "Blocked: the last ai-kit:decider call has no Verdict", "Blocked: the last ai-kit:decider call has no Verdict lines yet."),
  stop("stop.block.no-review", "Code changed with no review yet", "Code changed with no review yet: launch a reviewer"),
  stop("stop.block.since-review", "Code changed since the last review", "Code changed since the last review. Fixes for its findings"),
  stop("stop.block.since-recheck", "Code changed since the re-check", "Code changed since the re-check. Fixes for its findings"),
  m("post-edit.fail", "hooks/post-edit-check.sh", "block", "(pre-commit will block these)", "Checks failing on src/a.ts (pre-commit will block these):\nlint error",
    /Checks failing on .* \(pre-commit will block these\)/, "PostToolUse"),
  m("handoff.read-count", "hooks/handoff-nudge.sh", "note", "reads or searches since the last prompt in the main session",
    "15 reads or searches since the last prompt in the main session at about 80k tokens of context", undefined, "PostToolUse"),
  m("handoff.whole-file", "hooks/handoff-nudge.sh", "note", "lines, read whole. Next time find the symbol with grep -n",
    "big.ts is 900 lines, read whole. Next time find the symbol with grep -n and read only its line range", undefined, "PostToolUse"),
  m("handoff.max-context", "hooks/handoff-nudge.sh", "note", "This session's context is about", "This session's context is about 180k tokens. Do not stop",
    /This session's context is about \d+k tokens/, "UserPromptSubmit"),
  m("session-start.kit-proposals-note", "hooks/session-start.sh", "note", "Unfiled kit proposals in ai/kit/kit-proposals.md",
    "Unfiled kit proposals in ai/kit/kit-proposals.md: file them", undefined, "SessionStart"),
  m("session-start.plans-note", "hooks/session-start.sh", "note", "Plans in ai/plans not closed", "Plans in ai/plans not closed, status from their commits:", undefined, "SessionStart"),
  m("session-start.memory-note", "hooks/session-start.sh", "note", "Local auto-memory files in", "Local auto-memory files in /x/memory: run /ai-kit:memory-export", undefined, "SessionStart"),
  m("session-start.unattended-stale-note", "hooks/session-start.sh", "note", "out of date for unattended runs",
    "This repo's generated ai/kit files are out of date for unattended runs: run sync", undefined, "SessionStart"),
  m("pre-commit.docs", PC, "git", "Docs rule failed", "Docs rule failed. Drop emoji"),
  m("pre-commit.comments", PC, "git", "Comment rule failed", "Comment rule failed. Shorten to 1-2 lines"),
  m("pre-commit.size", PC, "git", "ALLOW_LARGE_EDIT=1 git commit", "When the split cannot come first: ALLOW_LARGE_EDIT=1 git commit ..."),
  m("pre-commit.backslash", PC, "git", "staged path contains a backslash", "commit blocked: staged path contains a backslash (\\)"),
  m("pre-commit.eslint-moved", PC, "git", "an eslint-disable gives", 'commit blocked: an eslint-disable gives "moved verbatim" as its reason:',
    /an eslint-disable gives "moved verbatim"/),
  m("pre-commit.prettier-fail", PC, "git", "prettier failed", "prettier failed - fix the error above"),
  m("pre-commit.node-missing", PC, "git", "'node' is not on PATH for this git client", "commit blocked: 'node' is not on PATH for this git client."),
  m("pre-commit.kit-check", PC, "git", "ai-kit check failed", "ai-kit check failed: apply the fix each line names."),
  m("commit-msg.job", "githooks/commit-msg", "git", "commit-msg: the message needs exactly one trailer", "commit-msg: the message needs exactly one trailer 'Job: <yyyy-mm-dd>-<slug>'"),
  // no hook message: a user prompt, an assistant text, a Bash command. Each mirrors the hook's own test
  { id: "stop.skip-review-escape", kind: "prompt", file: "hooks/review-before-stop.sh", anchor: "skip review", sample: "skip review, ship it",
    re: /^\s*(ไม่ต้อง ?review|skip review)/i },
  { id: "stop.review-closed-phrase", kind: "phrase", file: "hooks/review-before-stop.sh", anchor: "Review closed: re-checked once",
    sample: "Review closed: re-checked once, no third pass", re: /(?<!["`'“])Review closed: re-checked once/i },
  { id: "bash-guard.allow-build-while-dev", kind: "command", file: BG, anchor: "ALLOW_BUILD_WHILE_DEV=1", sample: "ALLOW_BUILD_WHILE_DEV=1 npm run build",
    re: /ALLOW_BUILD_WHILE_DEV=1/ },
  { id: "pre-commit.allow-large-edit", kind: "command", file: PC, anchor: "ALLOW_LARGE_EDIT=1", sample: "ALLOW_LARGE_EDIT=1 git commit -m x", re: /ALLOW_LARGE_EDIT=1/ },
  { id: "pre-commit.no-verify", kind: "command", file: PC, anchor: "--no-verify", sample: "git commit --no-verify -m x",
    re: /(?:^|[;&|\n(])\s*(?:\w+=\S+\s+)*git(?:\s+(?:-C\s+\S+|-c\s+\S+|--?[\w-]+(?:=\S+)?))*\s+commit\s[^|;&\n]*--no-verify/ },
];

// a simple command that runs `git ... commit`; a grep for the words is not one
const GIT_COMMIT = /(?:^|[;&|\n(])\s*(?:\w+=\S+\s+)*git(?:\s+(?:-C\s+\S+|-c\s+\S+|--?[\w-]+(?:=\S+)?))*\s+commit(?:\s|$)/;
const STOP_FEEDBACK = /^Stop hook feedback:\s*/;
const EDIT_TOOLS = /^(Edit|Write|MultiEdit)$/;

const strings = (v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v.text === "string" ? [v.text] : []);

function* walk(dir) {
  let ents = [];
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

// Streams every transcript under dir once. since = "YYYY-MM-DD" cuts a file by mtime and a line by timestamp.
export async function scanHooks(dir, { since = "", kitOf = new Map() } = {}) {
  const sinceMs = since ? Date.parse(since) : -Infinity;
  const tools = new Map(); // tool_use id -> tool name, or "git-commit" for a Bash git commit; filled before any skip
  const seen = new Set();
  const attSeen = new Set();
  const sessions = new Set();
  const tally = new Map(); // id -> session -> {a: {main, sub}, b: {main, sub}} (a = primary source, b = fallback)
  const pending = []; // results whose tool_use came from a later file
  let files = 0;
  const bump = (id, session, side, slot) => {
    let per = tally.get(id);
    if (!per) tally.set(id, (per = new Map()));
    let s = per.get(session);
    if (!s) per.set(session, (s = { a: { main: 0, sub: 0 }, b: { main: 0, sub: 0 } }));
    s[slot][side]++;
  };
  const byKind = (k) => HOOK_EVENTS.filter((e) => (e.kind ?? "") === k);
  const bySrc = (s) => HOOK_EVENTS.filter((e) => e.src === s);
  const [prompts, phrases, commands] = ["prompt", "phrase", "command"].map(byKind);
  const [pre, block, note, git] = ["pre", "block", "note", "git"].map(bySrc);
  const postEdit = block.filter((e) => e.id === "post-edit.fail");
  const fromTool = (e, tool, text, session, side) => {
    if (e.src === "git" && tool === "git-commit") bump(e.id, session, side, "a");
    else if (e.src === "block" && EDIT_TOOLS.test(tool)) bump(e.id, session, side, "b");
  };

  for (const f of walk(dir)) {
    try {
      if (statSync(f).mtimeMs < sinceMs) continue;
    } catch {
      continue;
    }
    files++;
    const sub = f.includes(`${sep}subagents${sep}`);
    const fileSession = f.slice(dir.length + 1).split(sep)[0].replace(/\.jsonl$/, "");
    const rl = createInterface({ input: createReadStream(f, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue; // the live file's last line may be cut off
      }
      if (!o || typeof o !== "object") continue;
      const content = o.message?.content;
      if (o.type === "assistant" && Array.isArray(content))
        for (const b of content)
          if (b?.type === "tool_use" && b.id) tools.set(b.id, b.name === "Bash" && GIT_COMMIT.test(b.input?.command ?? "") ? "git-commit" : b.name);
      if (!o.uuid || !o.timestamp || seen.has(o.uuid)) continue;
      seen.add(o.uuid);
      if (!(Date.parse(o.timestamp) >= sinceMs)) continue;
      const session = o.sessionId ?? fileSession;
      sessions.add(session);
      const side = sub || o.isSidechain === true ? "sub" : "main";
      if (o.type === "attachment") {
        const a = o.attachment ?? {};
        const isBlock = a.type === "hook_blocking_error";
        const isNote = a.type === "hook_success" || a.type === "hook_additional_context";
        if (!isBlock && !isNote) continue;
        const texts = isBlock
          ? strings([a.blockingError?.blockingError, a.stderr, a.stdout, a.content])
          : strings([a.stdout, a.stderr, a.content]);
        for (const e of isBlock ? block : note) {
          if (e.event !== a.hookEvent) continue;
          const key = `${session}|${a.toolUseID}|${e.id}`;
          if (a.toolUseID && attSeen.has(key)) continue;
          if (texts.some((t) => e.re.test(t))) {
            if (a.toolUseID) attSeen.add(key);
            bump(e.id, session, side, "a");
          }
        }
      } else if (o.type === "user") {
        const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
        for (const b of blocks) {
          if (b?.type === "text" && typeof b.text === "string") {
            if (STOP_FEEDBACK.test(b.text)) {
              const body = b.text.replace(STOP_FEEDBACK, "");
              for (const e of block) if (e.event === "Stop" && e.re.test(body)) bump(e.id, session, side, "b");
            }
            if (side === "main" && o.isMeta !== true && !b.text.startsWith("<"))
              for (const e of prompts) if (e.re.test(b.text)) bump(e.id, session, side, "a");
          } else if (b?.type === "tool_result") {
            for (const text of strings(b.content)) {
              if (b.is_error === true && /^\s*PreToolUse:/.test(text)) for (const e of pre) if (e.re.test(text)) bump(e.id, session, side, "a");
              const tool = tools.get(b.tool_use_id);
              for (const e of [...git, ...postEdit]) {
                if (!e.re.test(text)) continue;
                if (tool) fromTool(e, tool, text, session, side);
                else pending.push({ e, id: b.tool_use_id, text, session, side });
              }
            }
          }
        }
      } else if (o.type === "assistant" && Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "text" && side === "main" && typeof b.text === "string")
            for (const e of phrases) if (e.re.test(b.text)) bump(e.id, session, side, "a");
          if (b?.type === "tool_use" && b.name === "Bash" && typeof b.input?.command === "string")
            for (const e of commands) if (e.re.test(b.input.command)) bump(e.id, session, side, "a");
        }
      }
    }
  }
  for (const p of pending) {
    const tool = tools.get(p.id);
    if (tool) fromTool(p.e, tool, p.text, p.session, p.side);
  }

  const events = new Map();
  for (const [id, per] of tally) {
    const c = { n: 0, main: 0, sub: 0, sessions: new Set(), kits: {} };
    for (const [session, s] of per) {
      const use = s.a.main + s.a.sub > 0 ? s.a : s.b;
      const n = use.main + use.sub;
      if (!n) continue;
      c.n += n;
      c.main += use.main;
      c.sub += use.sub;
      c.sessions.add(session);
      const kit = kitOf.get(session) ?? "?";
      c.kits[kit] = (c.kits[kit] ?? 0) + n;
    }
    if (c.n) events.set(id, c);
  }
  return { files, sessions: sessions.size, since, events };
}

const verCmp = (x, y) => (x === "?") - (y === "?") || x.localeCompare(y, undefined, { numeric: true });

// Fixed-size text: counts only, never a message or a path.
export function formatHooks(res, { cap = 40, idsCap = 12, kitsCap = 4 } = {}) {
  const out = [`files ${res.files} · sessions ${res.sessions} · since ${res.since || "start"}`];
  const rows = [...res.events].sort((x, y) => y[1].n - x[1].n || x[0].localeCompare(y[0]));
  for (const [id, c] of rows.slice(0, cap)) {
    const kits = Object.keys(c.kits).sort(verCmp);
    const shown = kits.slice(0, kitsCap).map((k) => `${k}:${c.kits[k]}`).join(" ");
    const more = kits.length > kitsCap ? ` +${kits.length - kitsCap} more` : "";
    out.push(`${id}: ${c.n} (main ${c.main}, sub ${c.sub}) in ${c.sessions.size} sessions · kits ${shown}${more}`);
  }
  if (rows.length > cap) out.push(`+${rows.length - cap} more events`);
  const none = HOOK_EVENTS.map((e) => e.id).filter((id) => !res.events.has(id));
  if (none.length) out.push(`no firing: ${none.slice(0, idsCap).join(" ")}${none.length > idsCap ? ` +${none.length - idsCap} more` : ""}`);
  out.push("note: a kit whose hook text differed from the current table counts 0; no firing is not proof a hook is unused");
  return out.join("\n");
}
