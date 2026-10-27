// Tests for decider.mjs: verdict parsing, reading decider subagent transcripts, the log files, the guard verdict and
// the report. Usage: node scripts/decider.test.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deciders, guard, loadDecisions, parseBlocks, report, subagentsDir, sync } from "./decider.mjs";

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

const block = (v, q, conf = "high") =>
  `Verdict: ${v}\nKind: ${v === "OWNER" ? "money" : "-"}\nQuestion: ${q}\nChoice: c-${q}\nReason: r\nConfidence: ${conf}\nUndo: u\nSources: a.ts:1; D3`;

eq("parse: two blocks", parseBlocks(`${block("DECIDED", "q1")}\n---\n${block("OWNER", "q2")}`).map((b) => [b.verdict, b.question]), [
  ["DECIDED", "q1"],
  ["OWNER", "q2"],
]);
eq("parse: bold keys and a fenced reply", parseBlocks("```\n**Verdict:** decided\n**Choice:** x\n```")[0], { verdict: "DECIDED", choice: "x" });
eq("parse: fields before the first Verdict and unknown verdicts are dropped", parseBlocks("Choice: x\nVerdict: maybe\nReason: y"), []);
eq("parse: a repeated field keeps the first", parseBlocks("Verdict: OWNER\nChoice: a\nChoice: b")[0].choice, "a");
eq("parse: a field is capped at 500 chars", parseBlocks(`Verdict: OWNER\nReason: ${"x".repeat(900)}`)[0].reason.length, 500);
eq("subagentsDir: from the session transcript", subagentsDir("/p/s1.jsonl"), "/p/s1/subagents");
eq("subagentsDir: from a subagent transcript", subagentsDir("/p/s1/subagents/agent-a.jsonl"), "/p/s1/subagents");

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "decider-")));
try {
  const repo = join(tmp, "repo");
  mkdirSync(join(repo, "ai", "kit"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  process.env.CLAUDE_PROJECT_DIR = repo;
  const subs = join(tmp, "proj", "s1", "subagents");
  mkdirSync(subs, { recursive: true });
  const transcript = join(tmp, "proj", "s1.jsonl");
  const input = { session_id: "s1", transcript_path: transcript };
  // agent <id> <type> <final text> [age in minutes]: a subagent transcript as Claude Code writes it
  const agent = (id, type, text, age = 0, ts = "2026-10-27T03:04:05Z") => {
    writeFileSync(join(subs, `agent-${id}.meta.json`), JSON.stringify({ agentType: type }));
    const lines = [
      { type: "user", message: { role: "user", content: "brief: Verdict: DECIDED quoted by the caller" } },
      { type: "assistant", timestamp: "2026-10-27T03:00:00Z", message: { content: [{ type: "text", text: "looking" }, { type: "tool_use" }] } },
    ];
    if (text) lines.push({ type: "assistant", timestamp: ts, message: { content: [{ type: "text", text }] } });
    writeFileSync(join(subs, `agent-${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const t = (Date.now() - age * 60000) / 1000;
    utimesSync(join(subs, `agent-${id}.jsonl`), t, t);
  };
  const logged = () => readdirSync(join(repo, "ai", "usage", "decisions", "2026-10")).sort();

  eq("guard: no decider yet", guard(input), "none");
  agent("a1", "ai-kit:decider", block("DECIDED", "q1"), 3);
  agent("r1", "ai-kit:change-reviewer", block("OWNER", "x"), 2);
  eq("deciders: only the decider type, its last assistant text", deciders(subs).map((d) => [d.id, d.blocks.length, d.ts]), [["a1", 1, "2026-10-27T03:04:05Z"]]);
  eq("guard: DECIDED", guard(input), "decided");
  eq("guard logs the decider once per call", logged(), ["s1.a1.jsonl"]);
  agent("a2", "ai-kit:decider", "", 1);
  eq("guard: newest decider has no verdict yet", guard(input), "pending");
  agent("a2", "ai-kit:decider", `${block("DECIDED", "q2")}\n---\n${block("OWNER", "q3")}`, 1);
  eq("guard: any OWNER block", guard(input), "owner");
  eq("guard: the OWNER call serves one ask, then the older DECIDED one shows", guard(input), "decided");
  agent("a3", "ai-kit:decider", block("OWNER", "q4", "low"), 45, "2026-10-27T05:00:00Z");
  eq("guard: an OWNER call older than 30 minutes does not count", guard(input), "decided");
  writeFileSync(join(subs, "agent-h1.meta.json"), JSON.stringify({ agentType: "ai-kit:decider" }));
  writeFileSync(join(subs, "agent-h1.jsonl"), JSON.stringify({ type: "assistant", timestamp: "2026-10-27T04:00:00Z",
    message: { content: [{ type: "tool_use", name: "SubagentHandback", input: { message: block("OWNER", "qh") } }] } }) + "\n");
  eq("guard: a verdict handed back through SubagentHandback", guard(input), "owner");
  sync(input);
  eq("sync: every decider with verdicts logged", logged(), ["s1.a1.jsonl", "s1.a2.jsonl", "s1.a3.jsonl", "s1.h1.jsonl"]);
  writeFileSync(join(repo, "ai", "usage", "decisions", "2026-10", "s1.a1.jsonl"), "kept\n");
  sync({ ...input, transcript_path: join(subs, "agent-a1.jsonl") });
  eq("sync: a written log file is never rewritten", readFileSync(join(repo, "ai", "usage", "decisions", "2026-10", "s1.a1.jsonl"), "utf8"), "kept\n");
  writeFileSync(join(repo, "ai", "usage", "decisions", "2026-10", "s1.a1.jsonl"), `${JSON.stringify({ ts: "2026-10-27T03:04:05Z", verdict: "DECIDED", question: "q1" })}\n`);

  const all = loadDecisions(repo);
  eq("load: every record in ts order", all.map((r) => r.question), ["q1", "q2", "q3", "qh", "q4"]);
  eq("load: since excludes older", loadDecisions(repo, "2026-10-28").length, 0);
  const md = report(all);
  eq("report: counts", md.includes("5 questions: 2 decided by the agent (0 low confidence), 3 sent to the owner."), true);
  eq("report: owner section", /## Sent to the owner[\s\S]*\| money \| q3 \|/.test(md), true);
  const hiLo = [{ ts: "2026-10-27T01:00:00Z", verdict: "DECIDED", question: "hi" }, { ts: "2026-10-27T02:00:00Z", verdict: "DECIDED", question: "lo", confidence: "low" }];
  eq("report: low confidence first", /Low confidence[\s\S]*\| lo \|[\s\S]*Decided by the agent[\s\S]*\| hi \|/.test(report(hiLo)), true);
  eq("report: empty since", report([], "2026-10-28"), "no decisions since 2026-10-28\n");
  eq("report: pipes escaped", report([{ ts: "2026-10-27T01:00:00Z", verdict: "DECIDED", question: "a|b" }]).includes("a\\|b"), true);

  agent("p1", "ai-kit:decider", block("OWNER", "qp"), 0.5);
  agent("p2", "ai-kit:decider", block("DECIDED", "qd"), 0.2);
  eq("guard: an unused OWNER call wins over a newer DECIDED one", guard(input), "owner");
  eq("guard: then the newer DECIDED one shows", guard(input), "decided");
  eq("guard: no transcript path lets the ask through", guard({ session_id: "s1" }), "owner");
  eq("guard: no session id lets the ask through", guard({ transcript_path: transcript }), "owner");
  rmSync(join(repo, "ai", "kit"), { recursive: true });
  eq("guard: a project without ai/kit lets the ask through", guard(input), "owner");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
