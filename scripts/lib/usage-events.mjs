// Rows of every /v1/events table for one session, rebuilt from its transcripts (main, subagents, workflow agents).
// Text stays whole and plain; column names and types: ai-kit-usage src/ingest.mjs TABLES.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { COMMIT_RE, collectSession, promptText, roleOf, sessionFiles, textOf, toolKey } from "./usage-collect.mjs";

export const TABLE_ORDER = ["sessions", "rounds", "agents", "model_calls", "tool_calls", "hook_events", "compactions", "commits"];

const int = (v) => (Number.isInteger(v) && Math.abs(v) <= 2_147_483_647 ? v : null);
const str = (v) => (typeof v === "string" && v !== "" ? v : null);
const tsOk = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

// Postgres text and jsonb refuse NUL and lone surrogates; everything else is kept as written.
export function clean(v) {
  if (typeof v === "string") return v.replace(/\u0000/g, "").toWellFormed();
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [clean(k), clean(x)]));
  return v;
}

function readEntries(path, skipSidechain) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  const end = buf.lastIndexOf(10) + 1;
  const entries = [];
  for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && !(skipSidechain && e.isSidechain)) entries.push(e);
    } catch {}
  }
  return { entries, bytes: buf.length };
}

// Skill by skill name, Agent/Task by subagent type, an MCP tool by its server; the rest as usage-collect's toolKey.
export function eventToolKey(b) {
  if (b.name === "Skill" && typeof b.input?.skill === "string") return `Skill:${b.input.skill}`;
  if ((b.name === "Agent" || b.name === "Task") && typeof b.input?.subagent_type === "string") return `${b.name}:${b.input.subagent_type}`;
  const mcp = /^mcp__(.+?)__/.exec(b.name ?? "");
  if (mcp) return `mcp:${mcp[1]}`;
  return toolKey(b);
}

const TARGET_KEYS = ["file_path", "notebook_path", "command", "pattern", "skill", "url", "query", "description"];
export function targetOf(input) {
  if (!input || typeof input !== "object") return null;
  for (const k of TARGET_KEYS) if (typeof input[k] === "string" && input[k]) return input[k];
  return null;
}

// job and batch of an agent: run-plan labels `commit: [<batch>] ...` / `review: [<batch> fix] ...`, a brief's
// `Job: <id>` / `Batch: <id>` lines, else a job-shaped id in the description or brief.
export function jobBatch(desc, brief) {
  const d = String(desc ?? "");
  const b = String(brief ?? "");
  const JOB = /\b\d{4}-\d{2}-\d{2}-[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\b/;
  const job = /\bJob(?: id)?:\s*`?(\d{4}-\d{2}-\d{2}-[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)/.exec(b)?.[1] ?? JOB.exec(d)?.[0] ?? JOB.exec(b)?.[0] ?? null;
  const tag = /^\s*(?:commit|review):\s*\[([^\]\s]+)/i.exec(d)?.[1];
  const batch = (tag && tag !== "job" ? tag : null) ?? /\bBatch(?: id)?:\s*`?([A-Za-z0-9](?:[\w-]|\.(?=\w))*)/.exec(b)?.[1] ?? null;
  return { job, batch };
}

const OUTCOME = {
  hook_success: "success", hook_blocking_error: "block", hook_non_blocking_error: "error", hook_error_during_execution: "error",
  hook_additional_context: "context", hook_system_message: "message", hook_cancelled: "cancelled",
};

function hookContent(a) {
  if (a.type === "hook_blocking_error") return a.blockingError?.blockingError ?? (typeof a.content === "string" ? a.content : null);
  if (Array.isArray(a.content)) return a.content.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n");
  if (typeof a.content === "string" && a.content) return a.content;
  return str(a.stdout) ?? str(a.stderr) ?? (typeof a.content === "string" ? a.content : null);
}

// A main prompt: usage-collect's rule (own text after injected elements), or a slash command whose body the harness
// expanded (the next user entry is isMeta); a local command such as /model answers itself and is no round.
function promptsOf(entries) {
  const out = [];
  entries.forEach((e, i) => {
    const msg = e.message;
    if (e.type !== "user" || !msg || e.isMeta || e.isCompactSummary || e.isVisibleInTranscriptOnly) return;
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    if (blocks.some((b) => b?.type === "tool_result")) return;
    const raw = typeof msg.content === "string" ? msg.content : blocks.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
    const text = typeof msg.content === "string" ? promptText(msg.content)
      : blocks.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => promptText(b.text)).filter(Boolean).join("\n");
    const name = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/.exec(raw)?.[1] ?? null;
    let prompt = text;
    if (!prompt && name) {
      const next = entries.slice(i + 1).find((x) => x.type === "user");
      if (!next?.isMeta || /<local-command/.test(JSON.stringify(next.message?.content ?? ""))) return;
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)?.[1]?.trim();
      prompt = `/${name}${args ? ` ${args}` : ""}`;
    }
    if (!prompt || !tsOk(e.timestamp)) return;
    out.push({ ts: e.timestamp, prompt, command: name, permission_mode: str(e.permissionMode), git_branch: str(e.gitBranch) });
  });
  return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

// Rows of one transcript file for agent `agent`; tool use ids, workflow launches and commits go to `acc`.
function fileRows(entries, agent, session, roundAt, acc) {
  const calls = new Map();
  const seenUuid = new Set();
  const tools = new Map();
  let reqEffort = null;
  const span = { first: null, last: null, model: null, effort: null, brief: [] };
  let replied = false;
  for (const e of entries) {
    const ts = tsOk(e.timestamp) ? e.timestamp : null;
    if (ts) {
      span.first ??= ts;
      if (!span.last || Date.parse(ts) > Date.parse(span.last)) span.last = ts;
    }
    const msg = e.message;
    if (e.type === "api-request-blob" && typeof msg?.output_config?.effort === "string") reqEffort = msg.output_config.effort;
    if (e.type === "assistant" && msg && msg.model !== "<synthetic>") {
      replied = true;
      const id = String(msg.id ?? e.uuid ?? "");
      if (!id || !ts) continue;
      let c = calls.get(id);
      if (!c) {
        c = { session_id: session, msg_id: id, agent_id: agent, round: roundAt(ts), ts, model: null, request_id: null, effort: null,
          input: null, cache_read: null, cache_write_5m: null, cache_write_1h: null, output: null, stop_reason: null, thinking_ms: null,
          text: null, text_chars: 0, tool_uses: 0 };
        calls.set(id, c);
      }
      const u = msg.usage;
      if (u) {
        const cc = u.cache_creation;
        c.input = int(u.input_tokens ?? 0);
        c.cache_read = int(u.cache_read_input_tokens ?? 0);
        c.cache_write_5m = int(cc ? (cc.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0));
        c.cache_write_1h = int(cc?.ephemeral_1h_input_tokens ?? 0);
        c.output = int(u.output_tokens ?? 0);
      }
      if (str(msg.model)) c.model = span.model = msg.model;
      c.request_id = str(e.requestId) ?? c.request_id;
      const eff = str(e.effort) ?? reqEffort;
      if (eff) c.effort = span.effort = eff;
      c.stop_reason = str(msg.stop_reason) ?? c.stop_reason;
      c.thinking_ms = int(e.thinkingDurationMs) ?? c.thinking_ms;
      if (e.uuid && seenUuid.has(e.uuid)) continue;
      if (e.uuid) seenUuid.add(e.uuid);
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const t = textOf(blocks);
      if (t) {
        c.text = c.text ? `${c.text}\n${t}` : t;
        c.text_chars = c.text.length;
      }
      for (const b of blocks) {
        if (b?.type !== "tool_use" || typeof b.id !== "string" || tools.has(b.id)) continue;
        c.tool_uses++;
        const input = b.input ?? null;
        tools.set(b.id, { session_id: session, tool_use_id: b.id, agent_id: agent, msg_id: id, round: roundAt(ts), ts, tool: String(b.name ?? "?"),
          tool_key: eventToolKey(b), target: targetOf(input), input, input_chars: input === null ? 0 : JSON.stringify(input).length,
          result: null, result_chars: null, is_error: null, result_ts: null, duration_ms: null });
        acc.toolOwner.set(b.id, agent);
      }
    } else if (e.type === "user" && msg) {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      if (!replied && !blocks.some((b) => b?.type === "tool_result")) span.brief.push(textOf(msg.content));
      for (const b of blocks) {
        if (b?.type !== "tool_result") continue;
        const row = tools.get(b.tool_use_id);
        if (!row) continue;
        const text = textOf(b.content);
        row.result = text;
        row.result_chars = text.length;
        row.is_error = b.is_error === true;
        if (ts) {
          row.result_ts = ts;
          const d = Date.parse(ts) - Date.parse(row.ts);
          row.duration_ms = d >= 0 ? int(d) : null;
        }
        const m = row.tool === "Bash" && COMMIT_RE.exec(text);
        if (m && !acc.commits.some((x) => x.hash === m[1])) acc.commits.push({ hash: m[1], ts: ts ?? row.ts, agent });
        const run = row.tool === "Workflow" && /Run ID: (wf_[\w-]+)/.exec(text)?.[1];
        if (run && !acc.runLauncher.has(run)) acc.runLauncher.set(run, agent);
      }
    } else if (e.type === "attachment" && /^hook_/.test(e.attachment?.type ?? "") && ts) {
      const a = e.attachment;
      const content = hookContent(a);
      acc.hooks.push({ session_id: session, event_id: `${e.uuid ?? ts}:0`, agent_id: agent, round: roundAt(ts), ts,
        event: str(a.hookEvent) ?? str(String(a.hookName ?? "").split(":")[0]), hook: str(a.command) ?? str(a.blockingError?.command) ?? str(a.hookName),
        outcome: OUTCOME[a.type] ?? a.type.slice("hook_".length), tool_use_id: str(a.toolUseID), content, content_chars: content?.length ?? null,
        duration_ms: int(a.durationMs) });
    } else if (e.type === "system" && e.subtype === "stop_hook_summary" && ts && Array.isArray(e.hookInfos)) {
      e.hookInfos.forEach((h, i) => {
        acc.hooks.push({ session_id: session, event_id: `${e.uuid ?? ts}:${i}`, agent_id: agent, round: roundAt(ts), ts,
          event: agent === "main" ? "Stop" : "SubagentStop", hook: str(h?.command), outcome: "summary", tool_use_id: str(e.toolUseID),
          content: null, content_chars: null, duration_ms: int(h?.durationMs) });
      });
    } else if (e.type === "system" && /compact_boundary$/.test(e.subtype ?? "") && ts) {
      const cm = e.compactMetadata ?? e.microcompactMetadata ?? {};
      acc.compactions.push({ session_id: session, event_id: String(e.uuid ?? ts), agent_id: agent, ts, trigger: str(cm.trigger), pre_tokens: int(cm.preTokens) });
    }
  }
  return { calls: [...calls.values()], tools: [...tools.values()], span };
}

const gitOut = (root, args, input) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "ignore"], timeout: 30000 });
  } catch {
    return "";
  }
};

// Commit rows: hashes the transcripts printed plus HEAD's commits inside the session's span (`git commit -q` prints
// none); each with its full hash, subject, shortstat and the last Job and Batch lines of its message.
export function commitRows(root, session, found, { since, until, roundAt }) {
  const hashes = [...found.map((c) => c.hash)];
  if (since) {
    const end = until ? new Date(Date.parse(until) + 60000).toISOString() : "";
    for (const h of gitOut(root, ["log", "-n", "500", `--since=${since}`, ...(end ? [`--until=${end}`] : []), "--format=%H", "HEAD"]).split("\n")) {
      if (h.trim()) hashes.push(h.trim());
    }
  }
  if (!hashes.length) return [];
  const full = new Map();
  const check = gitOut(root, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], `${hashes.join("\n")}\n`).split("\n");
  hashes.forEach((h, i) => {
    const [name, type] = (check[i] ?? "").split(" ");
    if (type === "commit") full.set(h, name);
  });
  const uniq = [...new Set(full.values())];
  if (!uniq.length) return [];
  const out = gitOut(root, ["log", "--no-walk=unsorted", "--shortstat", "--format=%x01%H%x00%cI%x00%s%x00%B%x02", ...uniq]);
  const byHash = new Map();
  for (const part of out.split("\x01").slice(1)) {
    const [head, stat = ""] = part.split("\x02");
    const [hash, cts, subject, body] = head.split("\x00");
    const n = (re) => int(Number(re.exec(stat)?.[1] ?? (/\d+ files? changed/.test(stat) ? 0 : Number.NaN)));
    const last = (re) => [...String(body ?? "").matchAll(re)].pop()?.[1] ?? null;
    byHash.set(hash, { cts, subject, body, files: n(/(\d+) files? changed/), insertions: n(/(\d+) insertions?\(/), deletions: n(/(\d+) deletions?\(/),
      job: last(/^Job: *(\S+) *$/gm), batch: last(/^Batch: *(\S+) *$/gm) });
  }
  const rows = [];
  for (const hash of uniq) {
    const d = byHash.get(hash);
    if (!d) continue;
    const seen = found.find((c) => full.get(c.hash) === hash);
    const ts = seen?.ts && tsOk(seen.ts) ? seen.ts : d.cts;
    rows.push({ hash, session_id: session, agent_id: seen?.agent ?? null, round: tsOk(ts) ? roundAt(ts) : null, ts: tsOk(ts) ? ts : null,
      subject: d.subject ?? null, job: d.job, batch: d.batch, files: d.files, insertions: d.insertions, deletions: d.deletions });
  }
  return rows;
}

// Every events row of the session; null when the main transcript cannot be read. bytes: main plus subagent files read.
// ctx: { session, root, user, host, kit, kits: [{ts, kit}] from the local buffer }.
export function buildEvents(transcript, ctx) {
  const main = readEntries(transcript, true);
  if (!main) return null;
  const { session } = ctx;
  const prompts = promptsOf(main.entries);
  const times = prompts.map((p) => Date.parse(p.ts));
  const roundAt = (ts) => {
    const t = Date.parse(ts);
    let n = 0;
    while (n < times.length && times[n] <= t) n++;
    return n;
  };
  const kitAt = (ts) => ctx.kits?.find((k) => k.ts >= ts)?.kit ?? ctx.kit ?? null;
  const acc = { toolOwner: new Map(), runLauncher: new Map(), commits: [], hooks: [], compactions: [] };
  const sess = collectSession(transcript);
  let bytes = main.bytes;
  const m = fileRows(main.entries, "main", session, roundAt, acc);
  const model_calls = [...m.calls];
  const tool_calls = [...m.tools];
  const agents = [{ session_id: session, agent_id: "main", parent_agent_id: null, tool_use_id: null, agent_type: null, role: "coordinator",
    description: null, model: str(sess.agents.main?.model) ?? m.span.model, effort: m.span.effort, workflow_run: null, job: null, batch: null, round: null,
    started_at: m.span.first, ended_at: m.span.last, findings_confirmed: null, findings_plausible: null }];
  let last = m.span.last;
  const subs = [];
  for (const f of sessionFiles(transcript)) {
    const r = readEntries(f.path, false);
    if (!r) continue;
    bytes += r.bytes;
    const rows = fileRows(r.entries, f.id, session, roundAt, acc);
    model_calls.push(...rows.calls);
    tool_calls.push(...rows.tools);
    if (rows.span.last && (!last || Date.parse(rows.span.last) > Date.parse(last))) last = rows.span.last;
    subs.push({ f, rows });
  }
  for (const { f, rows } of subs) {
    const meta = f.meta ?? {};
    const a = sess.agents[f.id] ?? {};
    const desc = str(meta.description);
    const { job, batch } = jobBatch(desc, rows.span.brief.join("\n"));
    const role = roleOf(meta.description, meta.agentType);
    agents.push({ session_id: session, agent_id: f.id,
      parent_agent_id: f.run ? (acc.runLauncher.get(f.run) ?? "main") : (acc.toolOwner.get(meta.toolUseId) ?? "main"),
      tool_use_id: str(meta.toolUseId), agent_type: str(meta.agentType), role, description: desc, model: str(a.model) ?? rows.span.model ?? str(meta.model),
      effort: str(a.effort) ?? rows.span.effort, workflow_run: str(f.run), job, batch, round: rows.span.first ? roundAt(rows.span.first) : null,
      started_at: rows.span.first, ended_at: rows.span.last,
      findings_confirmed: role === "reviewer" ? int(a.findings?.confirmed ?? 0) : null, findings_plausible: role === "reviewer" ? int(a.findings?.plausible ?? 0) : null });
  }
  const first = main.entries.find((e) => tsOk(e.timestamp))?.timestamp ?? null;
  const pick = (k) => main.entries.find((e) => str(e[k]))?.[k] ?? null;
  const lastOf = (k) => main.entries.findLast((e) => str(e[k]))?.[k] ?? null;
  const firstModel = main.entries.find((e) => e.type === "assistant" && str(e.message?.model) && e.message.model !== "<synthetic>")?.message.model ?? null;
  const sessions = [{ session_id: session, user_name: str(ctx.user), host: str(ctx.host), kit_version: str(ctx.kit), cc_version: lastOf("version"),
    entrypoint: pick("entrypoint"), cwd: pick("cwd"), worktree: ctx.root ? basename(ctx.root) : null, git_branch: lastOf("gitBranch"),
    first_model: firstModel, base_context: int(sess.baseContext), started_at: first, ended_at: last ?? first }];
  const rounds = prompts.map((p, i) => ({ session_id: session, round: i + 1, ts: p.ts, prompt: p.prompt, prompt_chars: [...p.prompt].length,
    command: p.command, permission_mode: p.permission_mode, git_branch: p.git_branch, kit_version: kitAt(p.ts) }));
  const commits = ctx.root ? commitRows(ctx.root, session, acc.commits, { since: first, until: last, roundAt }) : [];
  return {
    bytes,
    tables: clean({ sessions: first ? sessions : [], rounds, agents: agents.filter((a) => a.started_at), model_calls, tool_calls,
      hook_events: acc.hooks, compactions: acc.compactions, commits }),
  };
}

// POST bodies under maxBytes and maxRows each, tables in TABLE_ORDER so the sessions row is in the first one. A row
// over the server's 32 MiB body cap loses the tail of its result or text (result_chars keeps the full size).
export function chunkEvents(project, tables, { maxBytes = 8 * 1024 * 1024, maxRows = 10000 } = {}) {
  const ROW_MAX = 24 * 1024 * 1024;
  const chunks = [];
  let cur = null;
  let bytes = 0;
  let rows = 0;
  const open = () => {
    cur = { project };
    chunks.push(cur);
    bytes = 200;
    rows = 0;
  };
  open();
  for (const t of TABLE_ORDER) {
    for (let r of tables[t] ?? []) {
      let n = Buffer.byteLength(JSON.stringify(r)) + 1;
      if (n > ROW_MAX) {
        r = { ...r };
        for (const k of ["result", "text", "content", "prompt"]) if (typeof r[k] === "string") r[k] = r[k].slice(0, 4 * 1024 * 1024);
        if (t === "tool_calls" && Buffer.byteLength(JSON.stringify(r)) > ROW_MAX) Object.assign(r, { input: null, input_truncated: true });
        n = Buffer.byteLength(JSON.stringify(r)) + 1;
      }
      if (rows > 0 && (bytes + n > maxBytes || rows + 1 > maxRows)) open();
      (cur[t] ??= []).push(r);
      bytes += n;
      rows++;
    }
  }
  return chunks.filter((c) => Object.keys(c).length > 1);
}
