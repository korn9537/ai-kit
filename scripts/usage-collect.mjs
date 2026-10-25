// Reads Claude Code session transcripts into cumulative per-agent token totals (main session + subagents).
// Only complete lines are consumed; the cache keeps a byte offset and running totals per file.
import { execFileSync } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

// Text the harness or an IDE adds to a user entry; <pasted_content> is the user's own and stays.
const INJECTED = /^<((?:browser_instruction|ide_|system-reminder|task-notification|local-command|command-)[\w-]*)[^>]*>/;
const COMMIT_RE = /^\[[^\]\n]+ ([0-9a-f]{7,40})\]/m;

export function roleOf(desc, type) {
  if (/^\s*commit:/i.test(desc ?? "")) return "commit";
  if (/change-reviewer/.test(type ?? "") || /review/i.test(desc ?? "")) return "reviewer";
  if (/business-analyst/.test(type ?? "")) return "ba";
  return "other";
}

// Main worktree path with non-alphanumerics as '-', as hooks/lib.sh kit_memory_dir.
export function transcriptsDir(repoRoot) {
  let main = repoRoot;
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (common) main = common.replace(/\/\.git$/, "");
  } catch {}
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects", main.replace(/[^a-zA-Z0-9]/g, "-"));
}

export function loadCache(path) {
  try {
    const c = JSON.parse(readFileSync(path, "utf8"));
    if (c?.v === 1 && c.files) return { v: 1, files: c.files, bytesRead: 0 };
  } catch {}
  return { v: 1, files: {}, bytesRead: 0 };
}

export function saveCache(path, c) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ v: 1, files: c.files }));
  renameSync(tmp, path);
}

// ids maps message.id to its last counted usage, so a repeated id replaces rather than adds.
const freshFile = () => ({
  offset: 0, firstTs: null, baseContext: null, model: "", ids: {}, tu: {}, tools: {}, largest: 0, peak: 0,
  prompts: [], commits: [], last: null,
});

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

// A prompt's own text: leading injected elements dropped (an unclosed one takes the rest), interrupt marks are no prompt.
export function promptText(raw) {
  let t = String(raw).trimStart();
  for (let m = INJECTED.exec(t); m; m = INJECTED.exec(t)) {
    const end = t.indexOf(`</${m[1]}>`, m[0].length);
    t = end < 0 ? "" : t.slice(end + m[1].length + 3).trimStart();
  }
  t = t.trim();
  return t.startsWith("[Request interrupted") ? "" : t;
}

function toolKey(b) {
  if (b.name !== "Bash") return b.name;
  const cmd = String(b.input?.command ?? "").replace(/^\s*cd\s+[^&;]*(?:&&|;)\s*/, "");
  const word = cmd.trim().split(/\s+/)[0];
  return word ? `Bash:${word}` : "Bash";
}

function absorb(f, e, isMain) {
  f.firstTs ??= e.timestamp ?? null;
  const msg = e.message;
  if (e.type === "assistant" && msg) {
    if (msg.model === "<synthetic>") return;
    const u = msg.usage;
    if (u) {
      const cc = u.cache_creation;
      const w1 = cc?.ephemeral_1h_input_tokens ?? 0;
      const w5 = cc ? (cc.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0);
      const c = [u.input_tokens ?? 0, u.cache_read_input_tokens ?? 0, w5, w1, u.output_tokens ?? 0];
      const id = msg.id ?? e.uuid;
      if (f.baseContext === null) f.baseContext = c[0] + c[1] + c[2] + c[3];
      f.ids[id] = c;
      f.peak = Math.max(f.peak, c[0] + c[1] + c[2] + c[3]);
    }
    if (msg.model) f.model = msg.model;
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    for (const b of blocks) {
      if (b?.type !== "tool_use" || b.id in f.tu) continue;
      f.tu[b.id] = b.name;
      const k = toolKey(b);
      f.tools[k] = (f.tools[k] ?? 0) + 1;
    }
    const t = textOf(blocks);
    if (t) {
      const id = msg.id ?? e.uuid;
      if (f.last?.id !== id) f.last = { id, confirmed: 0, plausible: 0 };
      f.last.confirmed += (t.match(/\bCONFIRMED\b/g) ?? []).length;
      f.last.plausible += (t.match(/\bPLAUSIBLE\b/g) ?? []).length;
    }
  } else if (e.type === "user" && msg) {
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    for (const b of blocks) {
      if (b?.type !== "tool_result") continue;
      const t = textOf(b.content);
      f.largest = Math.max(f.largest, t.length);
      const m = f.tu[b.tool_use_id] === "Bash" && COMMIT_RE.exec(t);
      if (m && !f.commits.some((c) => c.hash === m[1])) f.commits.push({ ts: e.timestamp ?? "", hash: m[1] });
    }
    const isPrompt = isMain && !e.isMeta && !e.isCompactSummary && !e.isVisibleInTranscriptOnly
      && !blocks.some((b) => b?.type === "tool_result");
    const t = isPrompt ? (typeof msg.content === "string" ? promptText(msg.content)
      : blocks.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => promptText(b.text)).filter(Boolean).join("\n")) : "";
    if (t) f.prompts.push({ ts: e.timestamp ?? "", chars: [...t].length });
  }
}

// Reads from the cached offset to the last complete line; a half-written tail stays unread.
function readNew(path, cache, isMain) {
  const f = (cache.files[path] ??= freshFile());
  let fd;
  try {
    fd = openSync(path, "r");
  } catch {
    return f;
  }
  try {
    const size = fstatSync(fd).size;
    if (size < f.offset) Object.assign(f, freshFile());
    if (size === f.offset) return f;
    const buf = Buffer.alloc(size - f.offset);
    const n = readSync(fd, buf, 0, buf.length, f.offset);
    cache.bytesRead += n;
    const end = buf.subarray(0, n).lastIndexOf(10) + 1;
    if (!end) return f;
    for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (isMain && e.isSidechain) continue;
      absorb(f, e, isMain);
    }
    f.offset += end;
  } finally {
    closeSync(fd);
  }
  return f;
}

function agentOf(id, role, desc, model, f) {
  const a = { id, role, desc, model, calls: 0, input: 0, read: 0, write_5m: 0, write_1h: 0, output: 0, peak: f.peak,
    tools: { ...f.tools }, largest_result: f.largest };
  for (const [i, r, w5, w1, o] of Object.values(f.ids)) {
    a.calls++;
    a.input += i;
    a.read += r;
    a.write_5m += w5;
    a.write_1h += w1;
    a.output += o;
  }
  if (role === "reviewer") a.findings = { confirmed: f.last?.confirmed ?? 0, plausible: f.last?.plausible ?? 0 };
  return a;
}

export function collectSession(transcript, cache = { v: 1, files: {}, bytesRead: 0 }) {
  cache.bytesRead = 0;
  const mf = readNew(transcript, cache, true);
  const agents = { main: agentOf("main", "coordinator", "", mf.model, mf) };
  const commits = [...mf.commits];
  const subDir = join(dirname(transcript), basename(transcript, ".jsonl"), "subagents");
  let names = [];
  try {
    names = readdirSync(subDir).filter((n) => n.startsWith("agent-") && n.endsWith(".jsonl")).sort();
  } catch {}
  for (const name of names) {
    const id = name.slice("agent-".length, -".jsonl".length);
    let meta = {};
    try {
      meta = JSON.parse(readFileSync(join(subDir, `agent-${id}.meta.json`), "utf8"));
    } catch {}
    const f = readNew(join(subDir, name), cache, false);
    agents[id] = agentOf(id, roleOf(meta.description, meta.agentType), meta.description ?? "", f.model || (meta.model ?? ""), f);
    for (const c of f.commits) if (!commits.some((x) => x.hash === c.hash)) commits.push(c);
  }
  commits.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return {
    firstTs: mf.firstTs ?? "",
    baseContext: mf.baseContext,
    agents,
    prompts: mf.prompts.map((p, i) => ({ round: i + 1, ...p })),
    commits,
  };
}
