// Tests for usage-record.mjs: cumulative session totals to a per-round delta record, and the summary line.
// Usage: node scripts/usage-record.test.mjs
import { maskPrompt } from "./usage-mask.mjs";
import { buildRecord, summaryLine, weight } from "./usage-record.mjs";

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
function match(desc, got, re) {
  if (re.test(got)) {
    passed++;
    console.log(`ok   - ${desc}`);
  } else {
    failed++;
    console.log(`FAIL - ${desc}\n  got:  ${JSON.stringify(got)}\n  want: ${re}`);
  }
}

const agent = (o) => ({ id: "main", role: "coordinator", desc: "", model: "claude-x-1", calls: 0, input: 0, read: 0,
  write_5m: 0, write_1h: 0, output: 0, peak: 0, tools: {}, largest_result: 0, ...o });
const main1 = agent({ calls: 3, input: 3, read: 900, write_1h: 50, output: 10, peak: 953, tools: { "Bash:git": 1, Read: 2 }, largest_result: 5000 });
const sub = agent({ id: "x1", role: "commit", desc: "commit: foo", model: "claude-y-1", calls: 1, input: 1, write_5m: 3, write_1h: 4, output: 5, peak: 8 });
const session = {
  firstTs: "2026-01-01T00:00:00Z", baseContext: 953, agents: { main: main1, x1: sub },
  prompts: [{ round: 1, ts: "2026-01-01T00:00:00Z", text: "fix it with password=hunter2" }], commits: [],
};
const session2 = {
  ...session,
  agents: { main: agent({ calls: 5, input: 4, read: 1300, write_1h: 80, output: 25, peak: 1500, tools: { "Bash:git": 1, Read: 3 }, largest_result: 7000 }), x1: sub },
  prompts: [...session.prompts, { round: 2, ts: "2026-01-01T00:10:00Z", text: "second" }],
  commits: [{ ts: "2026-01-01T00:10:30Z", hash: "a1b2c3d" }],
};
const ctx = { now: new Date("2026-01-01T00:01:00Z"), kit: "2.0.0", project: "p", user: "u", branch: "b", prompts: "full", session: "s1" };
const ctx2 = { ...ctx, now: new Date("2026-01-01T00:11:30Z") };
const prices = { "claude-x": 2 };

const r1 = buildRecord(session, [], ctx);
const r2 = buildRecord(session2, [r1], ctx2);
const readOf = (r) => r.agents.reduce((n, a) => n + a.read, 0);
const resumed = buildRecord(session2, [r1], ctx2);
const all = [r1, resumed, buildRecord(session2, [r1, resumed], ctx2)].filter(Boolean);

eq("first record = whole session", r1.agents.find((a) => a.id === "main").read, 900);
eq("delta subtracts prior records; unchanged agent omitted, zero tool keys dropped",
  [r2.agents.find((a) => a.id === "main").read, r2.agents.map((a) => a.id), r2.agents[0].tools], [400, ["main"], { Read: 1 }]);
eq("nothing new → null", buildRecord(session2, [r1, r2], ctx2), null);
eq("resume after cache loss: no double count", all.reduce((n, r) => n + readOf(r), 0), 1300);
eq("round = number of prompts so far", r2.round, 2);
eq("prompt masked and cut", r1.prompt, maskPrompt(session.prompts[0].text));
eq("prompts none → no prompt key", "prompt" in buildRecord(session, [], { ...ctx, prompts: "none" }), false);
eq("commits only in this round", r2.commits, ["a1b2c3d"]);
eq("duration from the round's prompt", r2.duration_s, 90);
eq("base_context only on the first record", ["base_context" in r1, "base_context" in r2], [true, false]);
eq("no cost fields", JSON.stringify(r1).includes("cost"), false);
eq("weight", weight({ model: "claude-x-1", input: 1e6, read: 1e6, write_5m: 0, write_1h: 0, output: 1e5 },
  { "claude-x": 2 }), 2 * (1 + 0.1 + 0.5));
eq("5.5 model reads at 0.05 of base input", weight({ model: "claude-opus-5-5-20260101", read: 1e6 }, { "claude-opus-5-5": 4 }), 4 * 0.05);
eq("unpriced model", weight({ model: "other" }, {}), null);
match("summary line", summaryLine(r2, [r1, r2], prices, false), /^tokens this round .* \| context \d+k \| top: /);
match("first-in-repo notice", summaryLine(r1, [r1], prices, true), /prompts are recorded in ai\/usage.*"none"/);

// several records in one round: durations add up to the round's wall time, only the first carries the prompt
const sessionMore = { ...session, agents: { main: { ...main1, read: 1000 }, x1: sub } };
const rA = buildRecord(session, [], ctx);
const rB = buildRecord(sessionMore, [rA], { ...ctx, now: new Date("2026-01-01T00:03:00Z") });
eq("same round: durations sum to the round's wall time", [rA.round, rB.round, rA.duration_s + rB.duration_s], [1, 1, 180]);
eq("prompt only on the first record of a round", ["prompt" in rA, "prompt" in rB], [true, false]);

const long = { ...agent({ desc: `a long\n   description ${"x".repeat(100)}`, calls: 99999, read: 9e12, output: 9e12, peak: 9e8 }) };
const opus = { ...long, model: "claude-opus-5-5" };
const big = { agents: [opus, { ...opus, id: "c", role: "commit", model: "q" }, { ...opus, id: "r", role: "reviewer" }, { ...opus, id: "b", role: "ba", model: "q" }] };
const capped = summaryLine(big, [big, big, big], { "claude-opus-5-5": 4 }, false);
eq("summary part capped at 200 characters; in-eq dropped when desc shrink is not enough", [[...capped].length <= 200, capped.includes("in-eq")], [true, false]);
eq("notice appended whole after the cap", summaryLine(big, [big], { "claude-x": 2 }, true).endsWith(' · prompts are recorded in ai/usage/ (set "usage": {"prompts": "none"} in ai/kit/config.json to stop)'), true);
eq("desc collapsed to one line", [capped.includes("\n"), summaryLine({ agents: [agent({ desc: "a\n\nb", calls: 1, read: 5 })] }, [], prices, false).includes("top: a b ")], [false, true]);

let threw = false;
try {
  buildRecord(session, [], { ...ctx, session: undefined });
} catch {
  threw = true;
}
eq("no session id throws", threw, true);
eq("session id taken from a prior record", buildRecord(sessionMore, [rA], { ...ctx, session: undefined }).session, "s1");
eq("duplicate commit hashes collapse", buildRecord({ ...session, commits: [{ ts: "t", hash: "abc1234" }, { ts: "t", hash: "abc1234" }] }, [], ctx).commits, ["abc1234"]);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
