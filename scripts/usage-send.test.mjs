// Tests for the usage API path: events from fixture transcripts, chunked sends and retries, detached sends of end and
// flush, refusals, decider logs, migrate, project ids, views; a node:http mock. Usage: node scripts/usage-send.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatTable, normalizeRemote, projectId } from "./lib/usage-api.mjs";
import { buildEvents, chunkEvents, jobBatch } from "./lib/usage-events.mjs";
import { postLegacy, readSent, saveTranscriptPath, sendDecisions, sendRefusals, sendSession } from "./lib/usage-send.mjs";
import { loadAllDecisions } from "./decider.mjs";

let passed = 0;
let failed = 0;
function eq(desc, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    passed++;
    console.log(`ok   - ${desc}`);
  } else {
    failed++;
    console.log(`FAIL - ${desc}\n  got:  ${g}\n  want: ${w}`);
  }
}

// the mock API: keeps every request; `fail` > 0 answers that many POSTs with `failStatus` (500)
const mock = { reqs: [], fail: 0, failStatus: 500, records: [], decisions: [], views: [] };
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const send = (status, obj) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(obj));
    if (req.method === "POST") {
      const parsed = JSON.parse(body);
      mock.reqs.push({ path: url.pathname, body: parsed, bytes: Buffer.byteLength(body) });
      if (mock.fail > 0) {
        mock.fail--;
        return send(mock.failStatus, { error: mock.failStatus === 500 ? "internal error" : "items[0].ts must be timestamptz" });
      }
      return send(200, { written: {} });
    }
    mock.reqs.push({ path: url.pathname, query: String(url.searchParams) });
    if (url.pathname === "/v1/decisions") return send(200, { items: mock.decisions, next: null });
    if (url.pathname.startsWith("/v1/views/")) return send(200, { items: mock.views });
    return send(404, { error: "not found" });
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const API = `http://127.0.0.1:${server.address().port}`;
process.env.AI_KIT_USAGE_ENDPOINT = API;
const posts = (path) => mock.reqs.filter((r) => r.path === path && r.body);
const reset = () => {
  mock.reqs = [];
  mock.fail = 0;
  mock.failStatus = 500;
};
const aged = (path, s = 60) => utimesSync(path, Date.now() / 1000 - s, Date.now() / 1000 - s);
const run = (args, opts = {}) => new Promise((resolve) => {
  const t0 = Date.now();
  const c = spawn(process.execPath, [join(import.meta.dirname, "usage.mjs"), ...args], { ...opts, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  c.stdout.on("data", (d) => (out += d));
  c.stderr.on("data", (d) => (err += d));
  c.stdin.end(opts.input ?? "");
  c.on("close", (code) => resolve({ code, out, err, ms: Date.now() - t0 }));
});
const waitFor = async (fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (fn()) return true;
  return false;
};

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "usage-send-")));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
function repo(name, config = {}) {
  const r = join(tmp, name);
  mkdirSync(join(r, "ai", "kit"), { recursive: true });
  writeFileSync(join(r, "ai", "kit", "config.json"), JSON.stringify(config));
  git(r, "init", "-q");
  git(r, "config", "user.name", "tester");
  git(r, "config", "user.email", "t@t");
  git(r, "add", "-A");
  git(r, "commit", "-qm", "base");
  return r;
}
const jl = (rows) => `${rows.map((x) => JSON.stringify(x)).join("\n")}\n`;

try {
  // ---- the fixture: main + one Agent subagent + one workflow agent, in Claude Code's real entry shapes ----
  const root = repo("r1");
  const proj = join(tmp, "projects", "p");
  const S = "sess-1";
  const T = join(proj, `${S}.jsonl`);
  const sub = join(proj, S, "subagents");
  const wf = join(sub, "workflows", "wf_abc-123");
  mkdirSync(wf, { recursive: true });
  const ent = (o) => ({ isSidechain: false, sessionId: S, version: "2.1.322", entrypoint: "claude-vscode", cwd: root, gitBranch: "main", userType: "external", ...o });
  const usage = (input, read, out) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 7 }, output_tokens: out });
  const bigResult = `line\n${"x".repeat(5000)}\nend`;
  writeFileSync(T, jl([
    ent({ type: "attachment", uuid: "h1", timestamp: "2030-01-15T09:59:58Z", attachment: { type: "hook_success", hookName: "SessionStart:startup",
      toolUseID: "hs1", hookEvent: "SessionStart", content: "", stdout: "{\"hookSpecificOutput\":{}}", stderr: "", exitCode: 0,
      command: "\"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh\"", durationMs: 314 } }),
    ent({ type: "user", uuid: "u1", timestamp: "2030-01-15T10:00:00Z", permissionMode: "auto",
      message: { role: "user", content: "<system-reminder>injected</system-reminder>fix the login bug, please" } }),
    ent({ type: "api-request-blob", timestamp: "2030-01-15T10:00:01Z", message: { output_config: { effort: "high" } } }),
    ent({ type: "assistant", uuid: "a1", timestamp: "2030-01-15T10:00:05Z", requestId: "req_1", thinkingDurationMs: 900,
      message: { id: "msg_1", model: "claude-opus-5-5", stop_reason: null, content: [{ type: "text", text: "Looking." }], usage: usage(1, 100, 1) } }),
    ent({ type: "assistant", uuid: "a2", timestamp: "2030-01-15T10:00:06Z", requestId: "req_1",
      message: { id: "msg_1", model: "claude-opus-5-5", stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_read", name: "Read", input: { file_path: "/x/a.ts" } }], usage: usage(1, 100, 40) } }),
    ent({ type: "user", uuid: "u2", timestamp: "2030-01-15T10:00:07Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_read", content: bigResult }] } }),
    ent({ type: "assistant", uuid: "a3", timestamp: "2030-01-15T10:00:10Z",
      message: { id: "msg_2", model: "claude-opus-5-5", stop_reason: "tool_use", content: [
        { type: "tool_use", id: "tu_agent", name: "Agent", input: { subagent_type: "ai-kit:committer", description: "commit: login fix", prompt: "Job id: 2030-01-15-login. Batch id: B1." } },
        { type: "tool_use", id: "tu_skill", name: "Skill", input: { skill: "ai-kit:run-plan" } },
        { type: "tool_use", id: "tu_mcp", name: "mcp__claude-in-chrome__tabs_context_mcp", input: {} }], usage: usage(2, 200, 30) } }),
    ent({ type: "user", uuid: "u3", timestamp: "2030-01-15T10:01:00Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_agent", content: [{ type: "text", text: "committed" }] },
        { type: "tool_result", tool_use_id: "tu_skill", content: "skill loaded", is_error: true }] } }),
    ent({ type: "system", subtype: "stop_hook_summary", uuid: "sh1", timestamp: "2030-01-15T10:01:05Z", toolUseID: "st1", hookCount: 2,
      hookInfos: [{ command: "\"${CLAUDE_PLUGIN_ROOT}/hooks/review-before-stop.sh\"" }, { command: "\"${CLAUDE_PLUGIN_ROOT}/hooks/kit-log.sh\" stop", durationMs: 58 }],
      hookErrors: [], hookAdditionalContext: [], preventedContinuation: false, stopReason: "", hasOutput: true, level: "suggestion" }),
    ent({ type: "attachment", uuid: "h2", timestamp: "2030-01-15T10:01:05Z", attachment: { type: "hook_blocking_error", hookName: "Stop", toolUseID: "st1",
      hookEvent: "Stop", blockingError: { blockingError: "Code changed with no review yet", command: "\"${CLAUDE_PLUGIN_ROOT}/hooks/review-before-stop.sh\"" } } }),
    ent({ type: "attachment", uuid: "h3", timestamp: "2030-01-15T10:01:06Z", attachment: { type: "hook_system_message", content: "tokens this round ≈ $1",
      hookName: "Stop", toolUseID: "st1", hookEvent: "Stop" } }),
    ent({ type: "attachment", uuid: "h4", timestamp: "2030-01-15T10:01:06Z", attachment: { type: "hook_additional_context", content: ["ctx one", "ctx two"],
      hookName: "SessionStart", toolUseID: "SessionStart", hookEvent: "SessionStart" } }),
    ent({ type: "system", subtype: "compact_boundary", uuid: "cb1", timestamp: "2030-01-15T10:02:00Z", content: "Conversation compacted",
      compactMetadata: { trigger: "auto", preTokens: 209589, postTokens: 20686 } }),
    ent({ type: "user", uuid: "u4", timestamp: "2030-01-15T10:05:00Z", isSidechain: true, message: { role: "user", content: "sidechain, not a prompt" } }),
    ent({ type: "user", uuid: "u5", timestamp: "2030-01-15T10:05:00Z", message: { role: "user", content: "<command-message>ai-kit:usage</command-message>\n<command-name>/ai-kit:usage</command-name>\n<command-args>digest</command-args>" } }),
    ent({ type: "user", uuid: "u6", timestamp: "2030-01-15T10:05:00Z", isMeta: true, message: { role: "user", content: [{ type: "text", text: "Run the usage digest." }] } }),
    ent({ type: "user", uuid: "u7", timestamp: "2030-01-15T10:05:30Z", message: { role: "user", content: "<command-name>/model</command-name>\n<command-args>default</command-args>" } }),
    ent({ type: "user", uuid: "u8", timestamp: "2030-01-15T10:05:31Z", message: { role: "user", content: "<local-command-stdout>Set model</local-command-stdout>" } }),
    ent({ type: "assistant", uuid: "a4", timestamp: "2030-01-15T10:06:00Z",
      message: { id: "msg_3", model: "claude-opus-5-5", stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_wf", name: "Workflow", input: { scriptPath: "/s/run-plan.js" } }], usage: usage(3, 300, 5) } }),
    ent({ type: "user", uuid: "u9", timestamp: "2030-01-15T10:06:01Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_wf", content: "Workflow launched\nRun ID: wf_abc-123\nYou will be notified." }] } }),
    ent({ type: "assistant", uuid: "a5", timestamp: "2030-01-15T10:06:02Z", message: { id: "msg_s", model: "<synthetic>", content: [{ type: "text", text: "x" }] } }),
  ]));
  writeFileSync(join(sub, "agent-c1.meta.json"), JSON.stringify({ agentType: "ai-kit:committer", description: "commit: login fix", toolUseId: "tu_agent" }));
  writeFileSync(join(sub, "agent-c1.jsonl"), jl([
    ent({ type: "user", uuid: "c-u1", isSidechain: true, agentId: "c1", timestamp: "2030-01-15T10:00:11Z", message: { role: "user", content: "Job id: 2030-01-15-login. Batch id: B1." } }),
    ent({ type: "assistant", uuid: "c-a1", isSidechain: true, agentId: "c1", timestamp: "2030-01-15T10:00:20Z", effort: "medium",
      message: { id: "msg_c1", model: "claude-sonnet-5-5", stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_commit", name: "Bash", input: { command: "git commit -m x" } }], usage: usage(5, 50, 9) } }),
    ent({ type: "user", uuid: "c-u2", isSidechain: true, agentId: "c1", timestamp: "2030-01-15T10:00:30Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_commit", content: "[main PLACEHOLDER] fix login\n 1 file changed" }] } }),
  ]));
  writeFileSync(join(wf, "agent-w1.meta.json"), JSON.stringify({ agentType: "ai-kit:change-reviewer", description: "review: [B1 recheck] login fix", workflowPhase: "Fix" }));
  writeFileSync(join(wf, "agent-w1.jsonl"), jl([
    ent({ type: "user", uuid: "w-u1", isSidechain: true, agentId: "w1", timestamp: "2030-01-15T10:06:05Z", message: { role: "user", content: "review the job 2030-01-15-login" } }),
    ent({ type: "assistant", uuid: "w-a1", isSidechain: true, agentId: "w1", timestamp: "2030-01-15T10:06:30Z",
      message: { id: "msg_w1", model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "1. CONFIRMED a\n2. PLAUSIBLE b" }], usage: usage(1, 10, 2) } }),
  ]));

  // a real commit for the committer's transcript line, with trailers and a shortstat
  writeFileSync(join(root, "a.txt"), "one\ntwo\n");
  git(root, "add", "a.txt");
  execFileSync("git", ["commit", "-q", "-m", "fix login", "-m", "body text", "-m", "Batch: B1\nJob: 2030-01-15-login"], { cwd: root, env: { ...process.env, GIT_COMMITTER_DATE: "2030-01-15T10:00:25Z", GIT_AUTHOR_DATE: "2030-01-15T10:00:25Z" } });
  const short = git(root, "rev-parse", "--short", "HEAD");
  const full = git(root, "rev-parse", "HEAD");
  writeFileSync(join(sub, "agent-c1.jsonl"), readFileSync(join(sub, "agent-c1.jsonl"), "utf8").replace("PLACEHOLDER", short));

  const ctx = { session: S, root, user: "tester", host: "h", kit: "2.50.0", kits: [] };
  const ev = buildEvents(T, ctx).tables;
  eq("every table gets rows", Object.fromEntries(Object.entries(ev).map(([k, v]) => [k, v.length > 0])),
    { sessions: true, rounds: true, agents: true, model_calls: true, tool_calls: true, hook_events: true, compactions: true, commits: true });
  const s0 = ev.sessions[0];
  eq("session row", [s0.user_name, s0.host, s0.kit_version, s0.cc_version, s0.entrypoint, s0.worktree, s0.git_branch, s0.first_model, s0.started_at, s0.ended_at],
    ["tester", "h", "2.50.0", "2.1.322", "claude-vscode", "r1", "main", "claude-opus-5-5", "2030-01-15T09:59:58Z", "2030-01-15T10:06:30Z"]);
  eq("rounds: a prompt (injected part dropped, text kept whole) and a prompt-type slash command; /model and the sidechain are none",
    ev.rounds.map((r) => [r.round, r.prompt, r.prompt_chars, r.command, r.permission_mode]),
    [[1, "fix the login bug, please", 25, null, "auto"], [2, "/ai-kit:usage digest", 20, "ai-kit:usage", null]]);
  const call = (id) => ev.model_calls.find((c) => c.msg_id === id);
  eq("model call: the last usage seen for a message id wins, text and tool uses of all its entries", [call("msg_1").input + call("msg_1").cache_read, call("msg_1").output,
    call("msg_1").cache_write_1h, call("msg_1").text, call("msg_1").tool_uses, call("msg_1").stop_reason, call("msg_1").request_id, call("msg_1").thinking_ms, call("msg_1").effort],
  [101, 40, 7, "Looking.", 1, "tool_use", "req_1", 900, "high"]);
  eq("<synthetic> messages are no model call", ev.model_calls.some((c) => c.msg_id === "msg_s"), false);
  eq("round of each call: prompts at or before its time", ev.model_calls.map((c) => [c.msg_id, c.agent_id, c.round]).sort(),
    [["msg_1", "main", 1], ["msg_2", "main", 1], ["msg_3", "main", 2], ["msg_c1", "c1", 1], ["msg_w1", "w1", 2]]);
  const tool = (id) => ev.tool_calls.find((x) => x.tool_use_id === id);
  eq("tool call: full result kept, its size, target and duration", [tool("tu_read").result === bigResult, tool("tu_read").result_chars, tool("tu_read").target, tool("tu_read").duration_ms, tool("tu_read").is_error],
    [true, bigResult.length, "/x/a.ts", 1000, false]);
  eq("tool keys: Skill by skill, Agent by type, MCP by server, Bash by command", ["tu_skill", "tu_agent", "tu_mcp", "tu_commit"].map((id) => tool(id).tool_key),
    ["Skill:ai-kit:run-plan", "Agent:ai-kit:committer", "mcp:claude-in-chrome", "Bash:git"]);
  eq("tool input stored whole as JSON, an error result flagged", [tool("tu_agent").input.prompt, tool("tu_skill").is_error, tool("tu_mcp").result], ["Job id: 2030-01-15-login. Batch id: B1.", true, null]);
  const agent = (id) => ev.agents.find((a) => a.agent_id === id);
  eq("main agent row", [agent("main").role, agent("main").parent_agent_id, agent("main").model], ["coordinator", null, "claude-opus-5-5"]);
  eq("subagent row: parent, tool use, type, role, effort, job and batch from its brief, round",
    ["parent_agent_id", "tool_use_id", "agent_type", "role", "model", "effort", "job", "batch", "round", "workflow_run"].map((k) => agent("c1")[k]),
    ["main", "tu_agent", "ai-kit:committer", "commit", "claude-sonnet-5-5", "medium", "2030-01-15-login", "B1", 1, null]);
  eq("workflow agent row: launcher as parent, run, batch from its label, reviewer findings",
    ["parent_agent_id", "workflow_run", "role", "batch", "job", "findings_confirmed", "findings_plausible", "round"].map((k) => agent("w1")[k]),
    ["main", "wf_abc-123", "reviewer", "B1", "2030-01-15-login", 1, 1, 2]);

  // hook events and compactions in the shapes Claude Code writes
  const hooks = ev.hook_events.map((h) => [h.event_id, h.event, h.hook, h.outcome, h.content, h.duration_ms, h.round]);
  eq("hook events: attachments by type, a stop hook summary per hook", hooks, [
    ["h1:0", "SessionStart", "\"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh\"", "success", "{\"hookSpecificOutput\":{}}", 314, 0],
    ["sh1:0", "Stop", "\"${CLAUDE_PLUGIN_ROOT}/hooks/review-before-stop.sh\"", "summary", null, null, 1],
    ["sh1:1", "Stop", "\"${CLAUDE_PLUGIN_ROOT}/hooks/kit-log.sh\" stop", "summary", null, 58, 1],
    ["h2:0", "Stop", "\"${CLAUDE_PLUGIN_ROOT}/hooks/review-before-stop.sh\"", "block", "Code changed with no review yet", null, 1],
    ["h3:0", "Stop", "Stop", "message", "tokens this round ≈ $1", null, 1],
    ["h4:0", "SessionStart", "SessionStart", "context", "ctx one\nctx two", null, 1],
  ]);
  eq("compaction: trigger and tokens before", ev.compactions.map((c) => [c.event_id, c.agent_id, c.trigger, c.pre_tokens]), [["cb1", "main", "auto", 209589]]);

  // commits: the transcript's short hash resolved, shortstat, the message's Job and Batch lines
  const c0 = ev.commits.find((c) => c.hash === full);
  eq("commit row: full hash, subject, shortstat, trailers, agent and round", c0 && [c0.subject, c0.files, c0.insertions, c0.deletions, c0.job, c0.batch, c0.agent_id, c0.round],
    ["fix login", 1, 2, 0, "2030-01-15-login", "B1", "c1", 1]);
  eq("jobBatch: a run-plan label, a brief's lines, a job id in prose", [jobBatch("commit: [A] x", ""), jobBatch("other", "Batch: `C2`\nJob: 2030-01-01-a-b."), jobBatch("review findings of 2030-01-01-x", "")],
    [{ job: null, batch: "A" }, { job: "2030-01-01-a-b", batch: "C2" }, { job: "2030-01-01-x", batch: null }]);
  eq("text is stored plain: no base64 of desc or prompt", [agent("c1").description, ev.rounds[0].prompt], ["commit: login fix", "fix the login bug, please"]);

  // ---- sending: chunks, a 500 mid-way, a retry, an unchanged resend ----
  const bufDir = join(git(root, "rev-parse", "--path-format=absolute", "--git-common-dir"), "claude-usage");
  saveTranscriptPath(bufDir, S, T);
  const sctx = { root, bufDir, session: S, base: API, project: "github.com/o/r", user: "tester", host: "h", kit: "2.50.0" };
  const chunks = chunkEvents("p", ev, { maxBytes: 3000, maxRows: 4 });
  eq("chunks: under the row cap, the sessions row in the first", [chunks.every((c) => Object.keys(c).filter((k) => k !== "project").reduce((n, k) => n + c[k].length, 0) <= 4),
    "sessions" in chunks[0], chunks.length > 3], [true, true, true]);
  reset();
  mock.fail = 1;
  mock.reqs = [];
  let threw = "";
  try {
    await sendSession(sctx, { maxBytes: 3000, maxRows: 4 });
  } catch (e) {
    threw = e.message;
  }
  eq("a 500 throws and leaves .sent unwritten", [/HTTP 500/.test(threw), readSent(bufDir, S)], [true, null]);
  reset();
  const ok = await sendSession(sctx, { maxBytes: 3000, maxRows: 4 });
  const ep = posts("/v1/events");
  eq("the retry posts every chunk, each with the project", [ok.status, ep.length === ok.posts, ep.every((r) => r.body.project === "github.com/o/r"), ep.length > 3], ["sent", true, true, true]);
  const rowsPosted = (t) => ep.reduce((n, r) => n + (r.body[t]?.length ?? 0), 0);
  eq("and all rows of each table", ["model_calls", "tool_calls", "hook_events"].map(rowsPosted), [ev.model_calls.length, ev.tool_calls.length, ev.hook_events.length]);
  eq(".sent holds the transcript and the bytes sent", [readSent(bufDir, S).transcript, readSent(bufDir, S).bytes > readFileSync(T).length], [T, true]);
  reset();
  eq("an unchanged session posts nothing", [(await sendSession(sctx)).status, mock.reqs.length], ["unchanged", 0]);
  writeFileSync(join(bufDir, `${S}.send.lock`), `${process.pid}:x:tok`);
  eq("a held send lock skips the send", (await sendSession(sctx)).status, "locked");
  utimesSync(join(bufDir, `${S}.send.lock`), Date.now() / 1000 - 700, Date.now() / 1000 - 700);
  eq("a send lock older than 10 minutes is taken over", (await sendSession(sctx)).status, "unchanged");
  eq("and released", existsSync(join(bufDir, `${S}.send.lock`)), false);

  // ---- end and flush return at once and leave the send to a detached process ----
  const r2 = repo("r2");
  const env2 = { ...process.env, CLAUDE_PROJECT_DIR: r2, AI_KIT_USAGE_ENDPOINT: API };
  const T2 = join(tmp, "projects", "p", "sess-2.jsonl");
  writeFileSync(T2, readFileSync(T, "utf8").replaceAll(S, "sess-2"));
  reset();
  const end = await run(["end"], { env: env2, input: JSON.stringify({ session_id: "sess-2", transcript_path: T2, cwd: r2 }) });
  eq("end returns within 3 s with exit 0", [end.code, end.ms < 3000], [0, true]);
  eq("its detached send posts the session", await waitFor(() => posts("/v1/events").some((r) => r.body.sessions?.[0]?.session_id === "sess-2")), true);
  const buf2 = join(r2, ".git", "claude-usage");
  eq("and writes .sent after the last chunk", await waitFor(() => existsSync(join(buf2, "sess-2.sent"))), true);
  eq("nothing written under ai/usage", existsSync(join(r2, "ai", "usage")), false);
  reset();
  const old = Date.now() / 1000 - 7 * 3600;
  utimesSync(T2, old, old);
  writeFileSync(join(buf2, "sess-2.sent"), JSON.stringify({ transcript: T2, bytes: 1 }));
  utimesSync(join(buf2, "sess-2.sent"), old - 60, old - 60);
  const idle = await run(["flush", "--idle"], { env: env2 });
  eq("flush --idle returns at once", [idle.code, idle.ms < 3000], [0, true]);
  eq("and sends an idle session that grew since .sent", await waitFor(() => posts("/v1/events").length > 0), true);
  await waitFor(() => readSent(buf2, "sess-2")?.bytes > 1);
  reset();
  await run(["flush", "--idle", "--except", "sess-2"], { env: env2 });
  await new Promise((r) => setTimeout(r, 800));
  eq("flush --idle --except skips the named session", mock.reqs.length, 0);

  // ---- refusals and decider logs: sent, and deleted only on 2xx ----
  reset();
  const rbuf = join(buf2, "refusals");
  mkdirSync(rbuf, { recursive: true });
  writeFileSync(join(rbuf, "buffer.log"), jl([{ v: 1, ts: "2030-01-15T10:00:00Z", rule: "pre-commit.docs", kit: "2.50.0", branch: "main" }]));
  mock.fail = 1;
  let rerr = "";
  try {
    await sendRefusals(buf2, API, "github.com/o/r");
  } catch (e) {
    rerr = e.message;
  }
  eq("refusals: a 500 keeps them (taken out of the buffer, not deleted)", [/HTTP 500/.test(rerr), readdirSync(rbuf).filter((n) => n.startsWith("out-")).length], [true, 1]);
  writeFileSync(join(rbuf, "buffer.log"), jl([{ v: 1, ts: "2030-01-15T11:00:00Z", rule: "commit-msg.job", kit: "2.50.0", branch: "main" }]));
  eq("the next send posts both and deletes them", [await sendRefusals(buf2, API, "github.com/o/r"), readdirSync(rbuf)], [2, []]);
  const ri = posts("/v1/refusals").flatMap((r) => r.body.items);
  eq("refusal items carry the host, not v", [ri.length, ri.every((x) => typeof x.host === "string" && !("v" in x))], [3, true]);

  const logDir = join(r2, ".git", "claude-decider", "log");
  mkdirSync(logDir, { recursive: true });
  const dline = (q) => ({ ts: "2030-01-15T10:00:00Z", session: "sess-2", agent: "d1", verdict: "DECIDED", question: q, choice: "x" });
  writeFileSync(join(logDir, "sess-2.d1.jsonl"), jl([dline("q1"), dline("q2")]));
  aged(join(logDir, "sess-2.d1.jsonl"));
  reset();
  mock.fail = 1;
  try {
    await sendDecisions(logDir, API, "github.com/o/r");
  } catch {}
  eq("decider log: a 500 keeps the file", existsSync(join(logDir, "sess-2.d1.jsonl")), true);
  mock.decisions = [{ session_id: "sess-0", agent_id: "d0", seq: 0, project: "github.com/o/r", ts: "2030-01-14T10:00:00.000Z", verdict: "OWNER", kind: "money",
    confidence: null, question: "q0", choice: "y", reason: null, undo: null, sources: null, extra: null }];
  const merged = await loadAllDecisions(r2);
  eq("decider report: the API's decisions plus the unsent local ones, in ts order", [merged.error, merged.recs.map((r) => r.question)], ["", ["q0", "q1", "q2"]]);
  eq("decider log: on 2xx posted with seq per line, deleted, a .sent marker left", [await sendDecisions(logDir, API, "github.com/o/r"),
    posts("/v1/decisions").pop().body.items.map((x) => x.seq), readdirSync(logDir)], [2, [0, 1], ["sess-2.d1.sent"]]);

  // ---- usage.enabled false: no buffer, no send ----
  const r3 = repo("r3", { usage: { enabled: false } });
  const env3 = { ...process.env, CLAUDE_PROJECT_DIR: r3, AI_KIT_USAGE_ENDPOINT: API };
  const T3 = join(tmp, "projects", "p", "sess-3.jsonl");
  writeFileSync(T3, readFileSync(T, "utf8").replaceAll(S, "sess-3"));
  reset();
  await run(["record"], { env: env3, input: JSON.stringify({ session_id: "sess-3", transcript_path: T3, cwd: r3 }) });
  await run(["end"], { env: env3, input: JSON.stringify({ session_id: "sess-3", transcript_path: T3, cwd: r3 }) });
  await run(["send", "--session", "sess-3"], { env: env3 });
  await new Promise((r) => setTimeout(r, 800));
  eq("usage.enabled false: no buffer and nothing posted", [existsSync(join(r3, ".git", "claude-usage")), mock.reqs.length], [false, 0]);

  // ---- migrate: posts ai/usage/** and stages its removal; a failed POST removes nothing ----
  const r4 = repo("r4");
  const ud = join(r4, "ai", "usage");
  mkdirSync(join(ud, "2030-01"), { recursive: true });
  mkdirSync(join(ud, "refusals", "2030-01"), { recursive: true });
  mkdirSync(join(ud, "decisions", "2030-01"), { recursive: true });
  const v1 = (i) => ({ v: 1, ts: `2030-01-15T10:00:0${i}Z`, session: "old", round: i, kit: "2.40.0", agents: [{ id: "main", role: "coordinator", desc: "", model: "m", calls: 1 }] });
  writeFileSync(join(ud, "2030-01", "old.jsonl"), jl([v1(1), v1(2)]));
  writeFileSync(join(ud, "2030-01", "old.2.jsonl"), `${jl([v1(3)])}not json\n`);
  writeFileSync(join(ud, "refusals", "2030-01", "ab12cd-0011aabb.jsonl"), jl([{ v: 1, ts: "2030-01-15T10:00:00Z", rule: "pre-commit.docs", kit: "2.40.0", branch: "b" }]));
  writeFileSync(join(ud, "decisions", "2030-01", "old.d1.jsonl"), jl([dline("a"), dline("b")]));
  git(r4, "add", "-A");
  git(r4, "commit", "-qm", "usage");
  const env4 = { ...process.env, CLAUDE_PROJECT_DIR: r4, AI_KIT_USAGE_ENDPOINT: API };
  reset();
  mock.fail = 3;
  const bad = await run(["migrate"], { env: env4 });
  eq("migrate: a failed POST exits 2 and leaves ai/usage tracked and on disk", [bad.code, existsSync(join(ud, "2030-01", "old.jsonl")), git(r4, "status", "--porcelain")], [2, true, ""]);
  reset();
  const good = await run(["migrate"], { env: env4 });
  const leg = posts("/v1/legacy").flatMap((r) => r.body.items);
  eq("migrate posts v1 records (.N files too), refusals with the file's host hash, decisions with seq", [good.code, leg.length,
    posts("/v1/refusals")[0].body.items[0].host, posts("/v1/decisions")[0].body.items.map((x) => x.seq), posts("/v1/legacy")[0].body.project], [0, 3, "ab12cd", [0, 1], "local/r4"]);
  eq("and stages the removal without committing", [existsSync(ud), git(r4, "diff", "--cached", "--name-only").split("\n").length, git(r4, "log", "--oneline").split("\n").length], [false, 4, 2]);
  eq("and prints the commit command", /removal staged[\s\S]*git commit -m/.test(good.out), true);

  // ---- project id ----
  eq("project id: https, scp ssh, ssh:// and a port", [normalizeRemote("https://github.com/Korn9537/Kids-Star.git"), normalizeRemote("git@github.com:korn9537/kids-star.git"),
    normalizeRemote("ssh://git@github.com/korn9537/kids-star.git"), normalizeRemote("ssh://git@host.x:2222/o/r.git"), normalizeRemote("https://user:pw@gitlab.com/g/s/r/")],
  ["github.com/korn9537/kids-star", "github.com/korn9537/kids-star", "github.com/korn9537/kids-star", "host.x:2222/o/r", "gitlab.com/g/s/r"]);
  git(r4, "remote", "add", "origin", "git@github.com:Org/Repo.git");
  eq("project id from origin, and local/<main worktree> without one", [projectId(r4), projectId(r2)], ["github.com/org/repo", "local/r2"]);
  git(r4, "worktree", "add", "-q", join(tmp, "r4-wt"));
  git(r4, "remote", "remove", "origin");
  eq("a linked worktree without origin names its main worktree", projectId(join(tmp, "r4-wt")), "local/r4");

  // ---- views: a fixed-width table ----
  mock.views = [{ kit_version: "2.50.0", sessions: 3, usd: "12.3456", first_seen: "2030-01-15T10:00:00.000Z", note: null }];
  reset();
  const v = await run(["views", "v_kit_compare", "--kit", "2.50."], { env: env2 });
  eq("views: header and a rounded row, kit passed, rows capped", [v.code, v.out.split("\n"), mock.reqs[0].query],
    [0, ["kit_version  sessions    usd  first_seen        note", "2.50.0              3  12.35  2030-01-15 10:00  -", ""], "kit=2.50.&limit=61"]);
  eq("formatTable caps rows", formatTable(Array.from({ length: 70 }, (_, i) => ({ n: i })), { cap: 60 }).split("\n").slice(-1)[0], "+10 more rows");
  const vbad = await run(["views", "nope"], { env: env2 });
  eq("views: a bad name exits 2", vbad.code, 2);

  // ---- a session sent from another worktree: its own worktree and commits, from its .transcript root ----
  const r5 = repo("r5");
  const r5b = join(tmp, "r5-b");
  git(r5, "worktree", "add", "-q", "-b", "b", r5b);
  const commitAt = (cwd, file, ts) => {
    writeFileSync(join(cwd, file), file);
    git(cwd, "add", file);
    execFileSync("git", ["commit", "-qm", `add ${file}`], { cwd, env: { ...process.env, GIT_COMMITTER_DATE: ts, GIT_AUTHOR_DATE: ts } });
    return git(cwd, "rev-parse", "HEAD");
  };
  const ca = commitAt(r5, "a5.txt", "2030-01-15T10:02:00Z");
  const cb = commitAt(r5b, "b5.txt", "2030-01-15T10:03:00Z");
  const buf5 = join(r5, ".git", "claude-usage");
  const copyAs = (id, cwd) => {
    const p = join(tmp, "projects", "p", `${id}.jsonl`);
    writeFileSync(p, readFileSync(T, "utf8").replaceAll(S, id).replaceAll(root, cwd));
    return p;
  };
  const fromB = async (id) => {
    reset();
    const r = await sendSession({ root: r5b, bufDir: buf5, session: id, base: API, project: "p5", user: "u", host: "h", kit: "2.50.0" });
    const ep = posts("/v1/events");
    return [r.status, ep.find((x) => x.body.sessions)?.body.sessions[0].worktree, ep.flatMap((x) => x.body.commits ?? []).map((c) => c.hash)];
  };
  saveTranscriptPath(buf5, "sess-5", copyAs("sess-5", r5), r5);
  eq(".transcript keeps the session's root on its second line", readFileSync(join(buf5, "sess-5.transcript"), "utf8").split("\n")[1], r5);
  eq("a session of worktree A sent from B: A's worktree and A's commits only", await fromB("sess-5"), ["sent", "r5", [ca]]);
  writeFileSync(join(buf5, "sess-6.transcript"), copyAs("sess-6", r5b));
  eq("a one-line .transcript: the root from the transcript's cwd", await fromB("sess-6"), ["sent", "r5-b", [cb]]);
  saveTranscriptPath(buf5, "sess-7", copyAs("sess-7", r5), join(tmp, "gone-wt"));
  eq("a root gone from disk: its name, no commit rows, never the sender's root", await fromB("sess-7"), ["sent", "gone-wt", []]);

  // ---- a transcript gone: its .transcript removed, and send says so ----
  writeFileSync(join(buf2, "sess-gone.transcript"), join(tmp, "nope.jsonl"));
  const gone = await run(["send", "--session", "sess-gone"], { env: env2 });
  eq("send: a gone transcript is named and its .transcript removed", [/sess-gone: transcript .*nope\.jsonl is gone/.test(gone.out), existsSync(join(buf2, "sess-gone.transcript"))], [true, false]);

  // ---- a 4xx: the session size marked rejected and not retried; files kept as .rejected; the loop goes on ----
  const S8 = "sess-8";
  saveTranscriptPath(buf5, S8, copyAs(S8, r5), r5);
  reset();
  mock.fail = 1;
  mock.failStatus = 400;
  const rej = await sendSession({ bufDir: buf5, session: S8, base: API, project: "p5", user: "u", host: "h", kit: "2.50.0" });
  eq("sendSession: a 400 returns rejected and marks that size in .sent", [rej.status, /HTTP 400/.test(rej.error), readSent(buf5, S8).rejected, readSent(buf5, S8).bytes > 0], ["rejected", true, true, true]);
  reset();
  eq("and the same size is not sent again", [(await sendSession({ bufDir: buf5, session: S8, base: API, project: "p5" })).status, mock.reqs.length], ["unchanged", 0]);

  const rdir = join(buf5, "refusals");
  mkdirSync(rdir, { recursive: true });
  const ref = (rule, ts = "2030-01-15T10:00:00Z") => ({ v: 1, ts, rule, kit: "2.50.0", branch: "main" });
  writeFileSync(join(rdir, "out-1.log"), jl([ref("a")]));
  writeFileSync(join(rdir, "out-2.log"), `${jl([ref("b"), ref(""), ref("c", ""), ref("d", "yesterday"), ref("e", "0000-01-01T00:00:00Z"), { ts: 5, rule: "f" }])}not json\n`);
  const logs = [];
  reset();
  mock.fail = 1;
  mock.failStatus = 400;
  const nref = await sendRefusals(buf5, API, "p5", { log: (m) => logs.push(m) });
  eq("refusals: a 400 file kept as .rejected, the next file still sent", [nref, readdirSync(rdir).sort(), logs.some((m) => /out-1\.log rejected.*HTTP 400/.test(m))],
    [1, ["out-1.log.rejected"], true]);
  eq("refusals: lines the server would refuse are dropped and counted", [posts("/v1/refusals").pop().body.items.map((x) => x.rule), logs.some((m) => /out-2\.log: 6 invalid line\(s\) dropped/.test(m))],
    [["b"], true]);

  writeFileSync(join(rdir, "out-3.log"), jl([ref("g")]));
  writeFileSync(join(rdir, "out-4.log"), jl([ref("h")]));
  reset();
  const both = await Promise.allSettled([sendRefusals(buf5, API, "p5", { log: () => {} }), sendRefusals(buf5, API, "p5", { log: () => {} })]);
  eq("refusals: two concurrent sends both finish and leave no out file", [both.map((x) => x.status), readdirSync(rdir).filter((n) => n.endsWith(".log"))], [["fulfilled", "fulfilled"], []]);

  const ldir = join(tmp, "dlog");
  mkdirSync(ldir);
  writeFileSync(join(ldir, "s.empty.jsonl"), "");
  aged(join(ldir, "s.empty.jsonl"));
  writeFileSync(join(ldir, "s.fresh.jsonl"), jl([dline("f")]));
  reset();
  eq("decisions: an empty file and one written under 5 s ago wait, unmarked", [await sendDecisions(ldir, API, "p5", { log: () => {} }), readdirSync(ldir).sort(), mock.reqs.length],
    [0, ["s.empty.jsonl", "s.fresh.jsonl"], 0]);
  rmSync(join(ldir, "s.empty.jsonl"));
  rmSync(join(ldir, "s.fresh.jsonl"));
  for (const a of ["a", "b", "c"]) {
    writeFileSync(join(ldir, `s.${a}.jsonl`), jl([dline(a), { ...dline("bad"), session: "" }, { ...dline("bad"), ts: "never" }]));
    aged(join(ldir, `s.${a}.jsonl`));
  }
  const dlogs = [];
  reset();
  mock.fail = 1;
  mock.failStatus = 413;
  eq("decisions: a 413 file kept as .rejected, unmarked; the rest sent with invalid lines dropped", [await sendDecisions(ldir, API, "p5", { log: (m) => dlogs.push(m) }),
    readdirSync(ldir).sort(), dlogs.filter((m) => /2 invalid line/.test(m)).length], [2, ["s.a.jsonl.rejected", "s.b.sent", "s.c.sent"], 3]);
  for (const a of ["d", "e"]) {
    writeFileSync(join(ldir, `s.${a}.jsonl`), jl([dline(a)]));
    aged(join(ldir, `s.${a}.jsonl`));
  }
  reset();
  const dboth = await Promise.allSettled([sendDecisions(ldir, API, "p5", { log: () => {} }), sendDecisions(ldir, API, "p5", { log: () => {} })]);
  eq("decisions: two concurrent sends both finish, each file marked sent", [dboth.map((x) => x.status), readdirSync(ldir).filter((n) => /^s\.[de]\./.test(n)).sort()],
    [["fulfilled", "fulfilled"], ["s.d.sent", "s.e.sent"]]);

  // ---- migrate: lines the server would refuse are skipped, not fatal; refused with usage off ----
  const r6 = repo("r6");
  mkdirSync(join(r6, "ai", "usage", "2030-01"), { recursive: true });
  writeFileSync(join(r6, "ai", "usage", "2030-01", "m.jsonl"), jl([v1(1), { ...v1(2), round: 2 ** 31 }, { ...v1(3), ts: "soon" }, { ...v1(4), session: "" },
    { ...v1(5), duration_s: 2 ** 40 }, { ...v1(6), agents: [{ id: "main", calls: 2 ** 33 }] }]));
  reset();
  const m6 = await run(["migrate"], { env: { ...env4, CLAUDE_PROJECT_DIR: r6 } });
  eq("migrate: invalid v1 lines are counted as skipped and the rest sent", [m6.code, posts("/v1/legacy").flatMap((r) => r.body.items).length, /5 unusable lines skipped/.test(m6.out)], [0, 1, true]);
  mkdirSync(join(r3, "ai", "usage"), { recursive: true });
  reset();
  const off = await run(["migrate"], { env: env3 });
  eq("migrate: usage.enabled false exits 2 with one line and posts nothing", [off.code, off.err.trim().split("\n").length, /usage\.enabled is false/.test(off.err), mock.reqs.length], [2, 1, true, 0]);

  // ---- postLegacy splits by bytes too ----
  reset();
  const big = Array.from({ length: 6 }, (_, i) => ({ ...v1(i), agents: [{ id: "main", desc: "x".repeat(3 * 1024 * 1024) }] }));
  await postLegacy(API, "p", { records: big, refusals: [], decisions: [] });
  const lp = posts("/v1/legacy");
  eq("postLegacy: large records split into bodies of at most 8 MiB", [lp.length > 2, lp.every((r) => r.bytes <= 8 * 1024 * 1024 + 4096), lp.reduce((n, r) => n + r.body.items.length, 0)], [true, true, 6]);

  // ---- a row cut to 4 MiB never ends in half a surrogate pair ----
  const cut = "a".repeat(4 * 1024 * 1024 - 1) + "\u{1F600}" + "b".repeat(21 * 1024 * 1024);
  const cutRow = chunkEvents("p", { tool_calls: [{ session_id: "s", tool_use_id: "t", agent_id: "main", ts: "2030-01-15T10:00:00Z", tool: "Read", result: cut }] })[0].tool_calls[0];
  eq("chunkEvents: a cut result is well formed", [cutRow.result.length <= 4 * 1024 * 1024, cutRow.result.isWellFormed()], [true, true]);

  // ---- views: a filter the server would refuse is refused here, without a request ----
  reset();
  const vp = await run(["views", "v_kit_compare", "--project"], { env: env2 });
  const vs = await run(["views", "v_tool_stats", "--since", "2030-01-01"], { env: env2 });
  eq("views: --project and --since on a cross-project, dateless view exit 2 with no request", [vp.code, /across projects/.test(vp.err), vs.code, /no date column/.test(vs.err), mock.reqs.length],
    [2, true, 2, true, 0]);
  const vd = await run(["views", "v_daily", "--since", "2030-01-01", "--project"], { env: env2 });
  eq("views: v_daily takes --since and --project", [vd.code, mock.reqs[0]?.query], [0, "since=2030-01-01&project=local%2Fr2&limit=61"]);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
