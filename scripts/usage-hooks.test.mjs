// Tests for `usage.mjs hooks` and scripts/lib/hook-events.mjs: counts per hook from fixture transcripts, and the drift
// guard that every HOOK_EVENTS anchor is still in its hook file. Usage: node scripts/usage-hooks.test.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HOOK_EVENTS, formatHooks, scanHooks } from "./lib/hook-events.mjs";
import { transcriptsDir } from "./lib/usage-collect.mjs";

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

const repo = join(import.meta.dirname, "..");
const tmp = mkdtempSync(join(tmpdir(), "usage-hooks-"));
const cfg = join(tmp, "config");
process.env.CLAUDE_CONFIG_DIR = cfg;
const T = "2026-11-05T10:00:00.000Z";
const OLD = "2026-10-01T10:00:00.000Z";
let n = 0;
const base = (o) => ({ uuid: `u${++n}`, timestamp: T, sessionId: "S1", isSidechain: false, ...o });
const use = (id, name, input, extra) => base({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] }, ...extra });
const result = (id, text, extra = {}, isError = false) =>
  base({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: isError }] }, ...extra });
const prompt = (text, extra) => base({ type: "user", message: { content: text }, ...extra });
const say = (text, extra) => base({ type: "assistant", message: { content: [{ type: "text", text }] }, ...extra });
const att = (a, extra) => base({ type: "attachment", attachment: a, ...extra });
const NOREV = "Code changed with no review yet: launch a reviewer";
const dup = base(result("t1", "commit-msg: the message needs exactly one trailer 'Job: <id>'"));

function project(name, { kit = true } = {}) {
  const root = join(tmp, name);
  mkdirSync(join(root, "ai", "kit"), { recursive: true });
  if (kit) {
    // the kit version per session comes from the local usage buffer
    spawnSync("git", ["init", "-q", root]);
    mkdirSync(join(root, ".git", "claude-usage"), { recursive: true });
    writeFileSync(join(root, ".git", "claude-usage", "S1.jsonl"), `${JSON.stringify({ v: 1, ts: T, agents: [], session: "S1", kit: "2.34.0" })}\n`);
  }
  return root;
}
const jl = (rows) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
function put(root, rel, rows, tail = "") {
  const p = join(transcriptsDir(root), rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, jl(rows) + tail);
  return p;
}

const root = project("p1");
put(root, "S1.jsonl", [
  use("t1", "Bash", { command: "git commit -m x" }),
  dup,
  dup,
  use("t2", "Bash", { command: "grep -n 'Docs rule failed' githooks/pre-commit" }),
  result("t2", "63:  echo \"Docs rule failed. Drop emoji\""),
  use("t2b", "Bash", { command: "git diff -- githooks/pre-commit" }),
  result("t2b", "+  echo \"Docs rule failed. Drop emoji\""),
  use("t2c", "Bash", { command: "git show HEAD:githooks/commit-msg" }),
  result("t2c", "commit-msg: the message needs exactly one trailer 'Job: x'"),
  use("t3", "Bash", { command: "git add -A" }),
  result("t3", "PreToolUse:Bash hook error: [x]: Blocked: a sweeping stage (git add -A).", {}, true),
  use("t4", "Agent", { subagent_type: "committer" }),
  result("t4", "report: Blocked: a sweeping stage; Docs rule failed; commit-msg: the message needs exactly one trailer"),
  use("t5", "Read", { file_path: "githooks/pre-commit" }),
  result("t5", "echo \"Comment rule failed. Shorten\""),
  att({ type: "hook_blocking_error", hookEvent: "Stop", toolUseID: "s1", blockingError: { blockingError: NOREV } }),
  prompt(`Stop hook feedback: ${NOREV}`),
  att({ type: "hook_blocking_error", hookEvent: "Stop", toolUseID: "s2", blockingError: { blockingError: "Code changed since the last review. Fixes" } }),
  att({ type: "hook_success", hookEvent: "PostToolUse", toolUseID: "p1", stdout: "{\"additionalContext\":\"15 reads or searches since the last prompt in the main session at about 80k\"}" }),
  att({ type: "hook_additional_context", hookEvent: "PostToolUse", toolUseID: "p1", content: ["15 reads or searches since the last prompt in the main session at about 80k"] }),
  att({ type: "hook_success", hookEvent: "SessionStart", toolUseID: "ss1", stdout: "Local auto-memory files in /x: run it" }),
  prompt("skip review please"),
  prompt("ไม่ต้อง review"),
  prompt("skip review (meta)", { isMeta: true }),
  prompt("<system-reminder>skip review</system-reminder>"),
  say("Checked\nReview closed: re-checked once, no third pass."),
  say("write `Review closed: re-checked once` as text"),
  say("Review closed: re-checked once", { isSidechain: true }),
  use("t6", "Bash", { command: "ALLOW_BUILD_WHILE_DEV=1 npm run build" }),
  use("t7", "Edit", { file_path: "a.ts" }),
  result("t7", "Checks failing on a.ts (pre-commit will block these):\nlint"),
  att({ type: "hook_blocking_error", hookEvent: "PostToolUse", toolUseID: "t7", blockingError: { blockingError: "Checks failing on a.ts (pre-commit will block these):" } }),
  // tool_use older than --since, its result newer
  use("told", "Bash", { command: "git commit -m y" }, { timestamp: OLD }),
  result("told", "ai-kit check failed: apply the fix"),
  // an old line, a line with no uuid, a line with no timestamp
  result("t1", "Docs rule failed. Drop emoji", { timestamp: OLD }),
  { type: "user", timestamp: T, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "Docs rule failed. x" }] } },
  { ...result("t1", "Docs rule failed. y"), timestamp: undefined },
], '{"uuid":"cut","timestamp":"2026-11-05T10:00:00.000Z","type":"us');
put(root, "S1/subagents/agent-a.jsonl", [
  use("s1", "Bash", { command: "git commit -m z" }, { isSidechain: true }),
  result("s1", "Docs rule failed. Drop emoji", { isSidechain: true }),
  use("s2", "Bash", { command: "git commit --no-verify -m z" }, { isSidechain: true }),
  say("Review closed: re-checked once", { isSidechain: true }),
  prompt("skip review", { isSidechain: true }),
]);
// S2: no usage record, Stop block only as 'Stop hook feedback:' text
put(root, "S2.jsonl", [prompt(`Stop hook feedback: ${NOREV}`, { sessionId: "S2" })]);
// an old file: skipped by --since on its mtime, counted without it
const oldFile = put(root, "S3.jsonl", [use("c1", "Bash", { command: "git commit -m q" }, { sessionId: "S3" }), result("c1", "Comment rule failed. Shorten", { sessionId: "S3" })]);
utimesSync(oldFile, new Date(OLD), new Date(OLD));

const kitOf = new Map([["S1", "2.34.0"]]);
const all = await scanHooks(transcriptsDir(root), { kitOf });
const cut = await scanHooks(transcriptsDir(root), { since: "2026-11-01", kitOf });
const c = (r, id) => {
  const e = r.events.get(id);
  return e ? [e.n, e.main, e.sub] : [0, 0, 0];
};
eq("files: all, and without the old-mtime file", [all.files, cut.files], [4, 3]);
eq("sessions", [all.sessions, cut.sessions], [3, 2]);
eq("commit-msg.job: dedup by uuid; Agent result quoting it counts 0", c(cut, "commit-msg.job"), [1, 1, 0]);
eq("pre-commit.docs: subagent result once; grep result, Agent quote, no-uuid and no-timestamp lines 0; old line cut by timestamp", c(cut, "pre-commit.docs"), [1, 0, 1]);
eq("pre-commit.docs without --since adds the old line", c(all, "pre-commit.docs"), [2, 1, 1]);
eq("pre-commit.comments: Read result 0; the old-mtime file only without --since", [c(cut, "pre-commit.comments"), c(all, "pre-commit.comments")], [[0, 0, 0], [1, 1, 0]]);
eq("pre-commit.kit-check: tool_use older than --since still names the tool", c(cut, "pre-commit.kit-check"), [1, 1, 0]);
eq("bash-guard.staging: error result once, Agent quote 0", c(cut, "bash-guard.staging"), [1, 1, 0]);
eq("stop.block.no-review: attachment + 'Stop hook feedback:' copy count once; a session with only the text counts it", c(cut, "stop.block.no-review"), [2, 2, 0]);
eq("stop.block.since-review", c(cut, "stop.block.since-review"), [1, 1, 0]);
eq("handoff.read-count: hook_success and additional_context of one call count once", c(cut, "handoff.read-count"), [1, 1, 0]);
eq("session-start.memory-note", c(cut, "session-start.memory-note"), [1, 1, 0]);
eq("post-edit.fail: attachment and tool_result copy count once", c(cut, "post-edit.fail"), [1, 1, 0]);
eq("stop.skip-review-escape: main prompts only; isMeta, '<' and subagent 0", c(cut, "stop.skip-review-escape"), [2, 2, 0]);
eq("stop.review-closed-phrase: main only; backtick-quoted and subagent 0", c(cut, "stop.review-closed-phrase"), [1, 1, 0]);
eq("command events", [c(cut, "bash-guard.allow-build-while-dev"), c(cut, "pre-commit.no-verify")], [[1, 1, 0], [1, 0, 1]]);
eq("kits per firing: usage record, and ? without one", [cut.events.get("stop.block.no-review").kits], [{ "2.34.0": 1, "?": 1 }]);

const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
const cli = (e, ...args) => spawnSync(process.execPath, [join(repo, "scripts", "usage.mjs"), "hooks", ...args], { env: e, encoding: "utf8" });
const r = cli(env, "--since", "2026-11-01");
const lines = r.stdout.split("\n");
eq("cli: exit 0 and header", [r.status, lines[0]], [0, "files 3 · sessions 2 · since 2026-11-01"]);
eq("cli: most first, per-line format", lines[1], "stop.block.no-review: 2 (main 2, sub 0) in 2 sessions · kits 2.34.0:1 ?:1");
eq("cli: no firing line lists a silent hook", lines.some((l) => l.startsWith("no firing: ") && l.includes("memory-guard")), true);
eq("cli: no message text, no path", /Blocked|Code changed|trailer|Drop emoji|reads or searches|\/tmp|usage-hooks-/.test(r.stdout), false);
eq("cli: bad flag exits 2", cli(env, "--bogus").status, 2);
const bare = project("p2", { kit: false });
rmSync(join(bare, "ai", "kit"), { recursive: true });
const noKit = cli({ ...env, CLAUDE_PROJECT_DIR: bare });
eq("no ai/kit: one line, exit 0", [noKit.status, noKit.stdout.trim().split("\n").length], [0, 1]);
const noDir = cli({ ...env, CLAUDE_PROJECT_DIR: project("p3") });
eq("no transcripts dir: one line, exit 0", [noDir.status, noDir.stdout.trim().split("\n").length], [0, 1]);
eq("empty transcripts dir", formatHooks(await scanHooks(join(tmp, "missing"))).split("\n")[0], "files 0 · sessions 0 · since start");

// the caps: events, no-firing ids, kit versions
const ev = (nn, kits) => ({ n: nn, main: nn, sub: 0, sessions: new Set(["a"]), kits });
const big = formatHooks({ files: 1, sessions: 1, since: "", events: new Map([["a", ev(3, { "2.1.0": 1, "?": 1, "2.0.0": 1 })], ["b", ev(2, {})], ["c", ev(1, {})]]) }, { cap: 2, idsCap: 3, kitsCap: 2 }).split("\n");
eq("cap: kits sorted, ? last, +k more", big[1], "a: 3 (main 3, sub 0) in 1 sessions · kits 2.0.0:1 2.1.0:1 +1 more");
eq("cap: +k more events and ids", [big[3], big[4].replace(/\d+ more/, "N more")], ["+1 more events", `no firing: ${HOOK_EVENTS.slice(0, 3).map((e) => e.id).join(" ")} +N more`]);
eq("40-line default cap", formatHooks({ files: 0, sessions: 0, since: "", events: new Map(Array.from({ length: 45 }, (_, i) => [`x${i}`, ev(1, {})])) }).split("\n").filter((l) => l.startsWith("x")).length, 40);

// DRIFT: a renamed hook message must fail here, not count 0 silently
for (const e of HOOK_EVENTS) {
  const text = readFileSync(join(repo, e.file), "utf8");
  eq(`drift: ${e.id} anchor is in ${e.file}`, text.includes(e.anchor), true);
  eq(`drift: ${e.id} sample holds the anchor and its regex matches it`, e.sample.includes(e.anchor) && e.re.test(e.sample), true);
}
eq("table ids are unique", new Set(HOOK_EVENTS.map((e) => e.id)).size, HOOK_EVENTS.length);

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
