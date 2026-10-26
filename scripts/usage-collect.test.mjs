// Tests for usage-collect.mjs: transcript JSONL to cumulative per-agent totals, with an incremental cache.
// Usage: node scripts/usage-collect.test.mjs
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSession, loadCache, mergeCommits, roleOf, saveCache, toolKey, transcriptsDir } from "./usage-collect.mjs";

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
const pick = (o, keys) => Object.fromEntries(keys.split(" ").map((k) => [k, o[k]]));

const usage = (input, read, w5, w1, output) => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: w5 + w1,
  cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: w1 },
  output_tokens: output,
});
const asst = (id, ts, block, u, extra = {}) =>
  JSON.stringify({ type: "assistant", timestamp: ts, ...extra, message: { id, model: "claude-opus-5", content: [block], usage: u } });
const user = (ts, content, extra = {}) => JSON.stringify({ type: "user", timestamp: ts, ...extra, message: { content } });
const text = (t) => ({ type: "text", text: t });
const tool = (id, name, input) => ({ type: "tool_use", id, name, input });
const result = (id, content) => ({ type: "tool_result", tool_use_id: id, content });
const lines = (...l) => l.join("\n") + "\n";

const dir = mkdtempSync(join(tmpdir(), "usage-collect-"));
const main = join(dir, "proj", "sess.jsonl");
const sub = join(dir, "proj", "sess", "subagents");
mkdirSync(sub, { recursive: true });

const u1 = usage(3, 900, 0, 50, 10);
const mainLines = [
  user("2026-01-01T00:00:00Z", "first ask"),
  user("2026-01-01T00:00:01Z", "<system-reminder>x</system-reminder>"),
  user("2026-01-01T00:00:01Z", "meta text", { isMeta: true }),
  user("2026-01-01T00:00:01Z", "<task-notification>done</task-notification>"),
  user("2026-01-01T00:00:01Z", "sidechain text", { isSidechain: true }),
  asst("m1", "2026-01-01T00:00:02Z", text("looking"), u1),
  asst("m1", "2026-01-01T00:00:02Z", tool("t1", "Bash", { command: "cd /x && sed -n 1p f" }), { ...u1, output_tokens: 30 }),
  user("2026-01-01T00:00:03Z", [result("t1", "x".repeat(5000))]),
  asst("m2", "2026-01-01T00:00:04Z", tool("t2", "Bash", { command: "git commit -m msg" }), usage(0, 0, 0, 0, 0)),
  asst("m2", "2026-01-01T00:00:04Z", tool("t3", "Read", { file_path: "/a" }), usage(0, 0, 0, 0, 0)),
  user("2026-01-01T00:00:05Z", [result("t2", [text("[main a1b2c3d] msg\n 1 file changed")]), result("t3", "ok")]),
  user("2026-01-01T00:00:06Z", [text("second ask")]),
  asst("s1", "2026-01-01T00:00:07Z", text("side"), usage(50, 50, 50, 50, 50), { isSidechain: true }),
  JSON.stringify({ type: "queue-operation", timestamp: "2026-01-01T00:00:08Z" }),
];
writeFileSync(main, lines(...mainLines));
writeFileSync(join(sub, "agent-x1.jsonl"), lines(asst("a1", "2026-01-01T00:00:04Z", text("done"), usage(1, 2, 3, 4, 5), { isSidechain: true })));
writeFileSync(join(sub, "agent-x1.meta.json"), JSON.stringify({ description: "commit: foo", agentType: "general-purpose", model: "haiku" }));
writeFileSync(
  join(sub, "agent-x2.jsonl"),
  lines(
    asst("b1", "2026-01-01T00:00:04Z", text("CONFIRMED early"), usage(1, 1, 1, 1, 1), { isSidechain: true }),
    asst("b2", "2026-01-01T00:00:05Z", text("CONFIRMED a. CONFIRMED b. PLAUSIBLE c."), usage(1, 1, 1, 1, 1), { isSidechain: true }),
  ),
);
writeFileSync(join(sub, "agent-x2.meta.json"), JSON.stringify({ description: "Review the change", agentType: "ai-kit:change-reviewer" }));
writeFileSync(join(sub, "agent-x3.jsonl"), lines(asst("c1", "2026-01-01T00:00:04Z", text("hi"), usage(1, 1, 1, 1, 1), { isSidechain: true })));

const s = collectSession(main);
eq("streamed blocks counted once, last usage wins", s.agents.main.output, 30);
eq("main excludes sidechain lines", s.agents.main.calls, 2);
eq("token fields", pick(s.agents.main, "input read write_5m write_1h"), { input: 3, read: 900, write_5m: 0, write_1h: 50 });
eq("peak = largest input+read+writes of one call", s.agents.main.peak, 953);

const base = join(dir, "proj", "base.jsonl");
writeFileSync(base, lines(asst("z1", "t", text("a"), usage(20, 90, 10, 0, 1)), asst("z2", "t", text("b"), usage(1, 500, 0, 0, 1))));
eq("base context = first main call", collectSession(base).baseContext, 120);
eq("tools: Bash by first word after a leading cd", s.agents.main.tools, { "Bash:sed": 1, "Bash:git": 1, Read: 1 });
eq("largest tool result in chars", s.agents.main.largest_result, 5000);
eq("prompts: real user text only, kept as a length (the text is never stored)",
  [s.prompts.map((p) => p.chars), JSON.stringify(s.prompts).includes("first ask")], [[9, 10], false]);
eq("commit hashes from git commit output", s.commits.map((c) => c.hash), ["a1b2c3d"]);
eq("subagent role from meta", s.agents.x1.role, "commit");
eq("reviewer findings from its last reply", s.agents.x2.findings, { confirmed: 2, plausible: 1 });
eq("no meta → other, still counted", [s.agents.x3.role, s.agents.x3.calls], ["other", 1]);

// prompt detection: what the harness or an IDE adds is not the user's ask
const pm = join(dir, "proj", "prompts.jsonl");
const ask = (t, ...a) => user("2026-01-01T00:00:00Z", t, ...a);
writeFileSync(pm, lines(
  ask("real one"),
  ask("summary of the old chat", { isCompactSummary: true }),
  ask("shown only", { isVisibleInTranscriptOnly: true }),
  ask("[Request interrupted by user]"),
  ask([text("[Request interrupted by user for tool use]")]),
  ask([text("<browser_instruction>use the tab</browser_instruction>")]),
  ask([text("<ide_opened_file>The user opened a.ts</ide_opened_file>"), text("ask after ide")]),
  ask([text("<ide_selection>x</ide_selection>"), text("<ide_diagnostics>y</ide_diagnostics>")]),
  ask("<ide_opened_file>a.ts</ide_opened_file>\n<system-reminder>r</system-reminder>\nstring ask after tags"),
  ask([text("<system-reminder>r</system-reminder>"), text("block ask")]),
  ask("<command-name>/foo</command-name><command-message>foo</command-message><command-args></command-args>"),
  ask("<local-command-stdout>out</local-command-stdout>"),
  ask("<local-command-caveat>c</local-command-caveat>"),
  ask([text("<pasted_content>my own paste</pasted_content>")]),
  ask("   "),
  asst("p1", "2026-01-01T00:00:01Z", text("ok"), usage(1, 1, 1, 1, 1)),
));
eq("prompts: injected text, interrupts, compact summaries and empty entries are not rounds",
  collectSession(pm).prompts.map((p) => p.chars),
  ["real one", "ask after ide", "string ask after tags", "block ask", "<pasted_content>my own paste</pasted_content>"].map((t) => [...t].length));
writeFileSync(join(dir, "proj", "thai.jsonl"), lines(user("2026-01-01T00:00:00Z", "<ide_opened_file>x</ide_opened_file>แก้ราคา ✓ 😀")));
eq("Thai and emoji counted by code point, injected tag not counted", collectSession(join(dir, "proj", "thai.jsonl")).prompts.map((p) => p.chars), [11]);

// a <synthetic> assistant message is no call: no usage, no model, no base context
const syn = join(dir, "proj", "syn.jsonl");
writeFileSync(syn, lines(
  JSON.stringify({ type: "assistant", timestamp: "t", message: { id: "y1", model: "<synthetic>", content: [text("No response requested.")], usage: usage(0, 0, 0, 0, 0) } }),
  asst("y2", "t", text("real"), usage(7, 100, 3, 0, 2)),
));
const ss = collectSession(syn);
eq("synthetic message is not counted", [ss.agents.main.calls, ss.agents.main.model, ss.baseContext], [1, "claude-opus-5", 110]);
const synOnly = join(dir, "proj", "syn-only.jsonl");
writeFileSync(synOnly, lines(JSON.stringify({ type: "assistant", timestamp: "t", message: { id: "y1", model: "<synthetic>", content: [text("x")], usage: usage(0, 0, 0, 0, 0) } })));
eq("a session of only synthetic messages: no call, no model, no base context",
  [collectSession(synOnly).agents.main.calls, collectSession(synOnly).agents.main.model, collectSession(synOnly).baseContext], [0, "", null]);

// a half-written last line is skipped and the offset stays before it; the cache then reads only what was appended
const part = join(dir, "proj", "part.jsonl");
const m3 = asst("m3", "2026-01-01T00:01:00Z", text("third"), usage(1, 1, 1, 1, 1));
writeFileSync(part, lines(...mainLines) + m3.slice(0, 40));
const cache = loadCache(join(dir, "no-such-cache.json"));
const s2 = collectSession(part, cache);
eq("half-written last line skipped", s2.agents.main.calls, 2);
appendFileSync(part, m3.slice(40) + "\n");
const cacheFile = join(dir, "cache", "usage.json");
saveCache(cacheFile, cache);
const cache2 = loadCache(cacheFile);
const s3 = collectSession(part, cache2);
eq("cache: second run reads only appended lines, same totals", [s3.agents.main.calls, cache2.bytesRead < statSync(part).size], [3, true]);

eq("roleOf", ["commit: x", "Review y", ""].map((d, i) => roleOf(d, ["", "", "ai-kit:business-analyst"][i])), ["commit", "reviewer", "ba"]);
process.env.CLAUDE_CONFIG_DIR = join(dir, "cfg");
eq("transcriptsDir slug", transcriptsDir("/Users/a.b/My Repo"), join(dir, "cfg", "projects", "-Users-a-b-My-Repo"));
eq("unreadable cache file loads empty", Object.keys(loadCache(main).files), []);
writeFileSync(join(dir, "old-cache.json"), JSON.stringify({ v: 1, files: { x: { offset: 99, prompts: [{ text: "plain prompt" }] } } }));
eq("a version 1 cache (it kept prompt text) is dropped and rebuilt", [loadCache(join(dir, "old-cache.json")).v, Object.keys(loadCache(join(dir, "old-cache.json")).files)], [2, []]);
saveCache(join(dir, "new-cache.json"), { files: {} });
eq("saved cache is version 2", JSON.parse(readFileSync(join(dir, "new-cache.json"), "utf8")).v, 2);

// tool keys never carry a path or a value: assignments, env and function definitions are skipped
const bk = (command) => toolKey({ name: "Bash", input: { command } });
eq("tools: assignments before the command are skipped, their paths never kept",
  ["S=/private/tmp/x/scratchpad; ls", "K=/Users/u/.claude/plugins/cache/k; node $K/a.mjs", "env FOO=1 npm test",
    "f='apps/web/[site_code]/x.tsx'; wc -l \"$f\"", 'F="ai/a b.md"; grep x $F'].map(bk),
  ["Bash:ls", "Bash:node", "Bash:npm", "Bash:wc", "Bash:grep"]);
eq("tools: a command substitution counts as its command, a path as its basename, a function as function",
  ["A=apps/api; f=$(find $A -name x)", "F=(ai/a.md src/b.ts); grep x ${F[@]}", "(time npx tsc)", "./scripts/run.sh a", "p(){ echo; }; p", 'F="ai/unclosed', ""].map(bk),
  ["Bash:find", "Bash:grep", "Bash:time", "Bash:run.sh", "Bash:function", "Bash", "Bash"]);
eq("tools: a quoted path is bare Bash, env options and a comment line are skipped",
  ['"/Users/me/My Docs/run.sh" a', "env -i X=1 npm test", "# look\ngrep x f"].map(bk), ["Bash", "Bash:npm", "Bash:grep"]);

// commits: git log joins what the transcript saw (git commit -q prints no hash)
const log = "a1b2c3d4e5f6 a1b2c3d4 2026-01-01T00:02:00+07:00\nffff0000aaaa ffff0000 2026-01-01T00:01:00+07:00";
eq("commits: git log adds quiet commits, a transcript hash of a logged commit appears once in git log spelling",
  mergeCommits([{ ts: "2025-12-31T17:01:30Z", hash: "a1b2c3d" }, { ts: "2025-12-31T17:03:00Z", hash: "0000abc" }], log).map((c) => c.hash),
  ["ffff0000", "a1b2c3d4", "0000abc"]);
eq("commits: no git log output keeps the transcript ones", mergeCommits([{ ts: "t", hash: "abc1234" }], "").map((c) => c.hash), ["abc1234"]);

rmSync(dir, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
