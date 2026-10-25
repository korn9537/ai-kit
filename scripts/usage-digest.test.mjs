// Tests for usage-digest.mjs: usage records to a fixed-size text digest, record loading and the local baseline.
// Usage: node scripts/usage-digest.test.mjs
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baselineRecords, digest, loadRecords } from "./usage-digest.mjs";

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

const P = { "claude-opus-5-5": 4, "claude-sonnet-5-5": 2 };
const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const ag = (o) => ({ id: "main", role: "coordinator", desc: "", model: OPUS, calls: 1, input: 0, read: 0, write_5m: 0, write_1h: 0,
  output: 0, peak: 0, tools: {}, largest_result: 0, ...o });
const rec = (o) => ({ v: 1, ts: "2026-02-01T10:00:00Z", session: "s1aaaaaa", round: 1, kit: "2.13.0", project: "p", user: "alice",
  branch: "b", duration_s: 5, commits: [], agents: [], ...o });

const recs = [
  rec({
    prompt: "fix the login bug", commits: ["a1b2c3d"], base_context: 31000,
    agents: [
      ag({ calls: 10, read: 8e6, peak: 90000, tools: { Read: 4 } }),
      ag({ id: "c1", role: "commit", desc: "commit: fix login", calls: 250, read: 2e7, peak: 406000, largest_result: 90000,
        tools: { "Bash:sed": 55, "Bash:grep": 70 } }),
      ag({ id: "c2", role: "commit", desc: "commit: tests", model: SONNET, calls: 5, read: 1e6, peak: 30000 }),
      ag({ id: "r1", role: "reviewer", desc: "review", calls: 20, read: 4e6, peak: 60000, findings: { confirmed: 2, plausible: 1 } }),
    ],
  }),
  rec({
    ts: "2026-02-03T10:00:00Z", session: "s2bbbbbb", kit: "2.13.1", user: "bob", base_context: 48000,
    prompt: `refactor ${"the billing module ".repeat(30)}`,
    agents: [
      ag({ calls: 4, read: 1e6, peak: 50000 }),
      ag({ id: "r2", role: "reviewer", desc: "review", model: SONNET, calls: 8, read: 1e6, peak: 40000, findings: { confirmed: 1, plausible: 0 } }),
    ],
  }),
  rec({ ts: "2026-02-03T11:00:00Z", session: "s2bbbbbb", kit: "2.13.1", user: "bob", round: 2, prompt: "second", agents: [ag({ calls: 2, read: 1e5, peak: 51000 })] }),
];
const d = digest(recs, P);

eq("empty", digest([], P), "no usage records");
const SECTIONS = ["totals", "by role", "per commit", "by kit", "drivers", "reviews", "costliest rounds", "outliers"];
eq("sections in order", [...d.matchAll(/^## (.+)$/gm)].map((m) => m[1]), SECTIONS);
match("role share and model within role", d, /commit 6\d% \(opus 9\d%, sonnet \d+%\)/);
match("cost per commit", d, /per commit ≈ \$\d/);
match("by kit compares versions", d, /2\.13\.0 .*\n2\.13\.1 /);
match("drivers name tool mix", d, /commit: .*Bash:sed \d+/);
match("reviews per model", d, /opus: \d+ reviews, [\d.]+ confirmed\/review/);
match("costliest rounds with prompt excerpt ≤ 200 chars", d, /^- \$[\d.]+ r\d+ \w+: .{1,200}$/m);
match("outliers over 150k peak or 150 calls", d, /peak 406k|250 calls/);
match("totals cost split by token type", d, /by type: read \d+%/);
match("person and cost in totals", d, /by user: alice \$[\d.]+ \d+%, bob /);
match("base context trend", d, /base context: 2026-02 40k|base context: .*2026-02 /);
match("header counts", d, /^records 3 · sessions 2 · rounds 3 · commits 1 · 2026-02-01\.\.2026-02-03/);
eq("a round's cost spans its records (round 2 of s2 is its own round)", (d.match(/^- \$[\d.]+ r\d+ /gm) ?? []).length, 3);
eq("long prompt cut", d.split("\n").filter((l) => l.startsWith("- $") && l.includes("refactor")).every((l) => l.includes("…")), true);

// size: bounded however many records, users, kits, models and tools there are
const many = [];
for (let i = 0; i < 10000; i++) {
  many.push(rec({
    ts: `2026-0${1 + (i % 9)}-15T00:00:00Z`, session: `s${i % 700}`, round: 1 + (i % 7), kit: `2.${i % 40}.0`, user: `user-number-${i % 300}-${"n".repeat(30)}`,
    project: `proj${i % 30}`, prompt: `prompt ${i} ${"w".repeat(400)}`, commits: i % 3 ? [] : [`h${i}`], base_context: 30000 + (i % 50) * 1000,
    agents: ["coordinator", "commit", "reviewer", "ba", "other", "x1", "x2", "x3", "x4", "x5"].map((role, j) => ag({
      id: `a${j}-${i}`, role, desc: `desc ${"d".repeat(100)} ${i}`, model: j % 4 ? `claude-model-${j}-with-a-very-long-name-${i % 20}` : OPUS,
      calls: 200 + j, read: 1e6 + i, peak: 200000 + j, tools: Object.fromEntries(Array.from({ length: 40 }, (_, t) => [`Bash:tool${t}${"z".repeat(40)}`, t + i])),
      findings: role === "reviewer" ? { confirmed: 1, plausible: 1 } : undefined,
    })),
  }));
}
const big = digest(many, P);
eq("bounded size", big.length <= 12000, true);
eq("bounded size keeps the sections", [...big.matchAll(/^## (.+)$/gm)].map((m) => m[1]), SECTIONS);

const unk = digest([rec({ agents: [ag({ model: "mystery-1", read: 1500, output: 10 }), ag({ id: "z", read: 1e6 })] })], P);
match("unpriced model reported apart", unk, /unpriced: \d+ tok/);
const onlyUnk = digest([rec({ agents: [ag({ model: "mystery-1", read: 1500 })] })], P);
match("only unpriced: no NaN, no cost", onlyUnk, /unpriced: 1500 tok/);
eq("no NaN or undefined anywhere", [d, big, unk, onlyUnk].some((t) => /NaN|undefined|Infinity/.test(t)), false);

match("meta shown in the header", digest(recs, P, { bad: 2, skipped: 1, source: "baseline" }), /baseline · 2 bad lines · 1 sessions skipped/);
match("empty with meta", digest([], P, { bad: 2 }), /^no usage records · 2 bad lines$/);

// loading: nested month dirs, bad lines skipped and counted, --since by record ts
const tmp = mkdtempSync(join(tmpdir(), "usage-digest-"));
try {
  mkdirSync(join(tmp, "2026-01"), { recursive: true });
  mkdirSync(join(tmp, "2026-02"), { recursive: true });
  const line = (o) => `${JSON.stringify(rec(o))}\n`;
  writeFileSync(join(tmp, "2026-01", "a.jsonl"), line({ ts: "2026-01-05T00:00:00Z" }) + "{not json\n" + "\n" + "[1,2]\n" + '{"ts":"2026-01-06T00:00:00Z"}\n');
  writeFileSync(join(tmp, "2026-02", "b.jsonl"), line({ ts: "2026-02-01T00:00:00Z" }) + line({ ts: "2026-02-02T00:00:00Z" }));
  writeFileSync(join(tmp, "2026-02", "notes.txt"), "ignored");
  const all = loadRecords(tmp);
  eq("load: records and bad lines", [all.recs.length, all.bad], [3, 3]);
  const since = loadRecords(tmp, "2026-02-01");
  eq("since filters by ts, inclusive", [since.recs.map((r) => r.ts.slice(0, 10)), since.bad], [["2026-02-01", "2026-02-02"], 3]);
  eq("missing dir", loadRecords(join(tmp, "nope")), { recs: [], bad: 0 });

  // baseline: one in-memory record per transcript, kit "baseline"; a broken one is skipped and counted
  const proj = join(tmp, "proj");
  const asst = (id, ts, text) => JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model: OPUS, content: [{ type: "text", text }],
    usage: { input_tokens: 1, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10, output_tokens: 5 } } });
  const user = (ts, text) => JSON.stringify({ type: "user", timestamp: ts, message: { content: text } });
  const prevCfg = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(tmp, "cfg");
  try {
    const tdir = join(tmp, "cfg", "projects", proj.replace(/[^a-zA-Z0-9]/g, "-"));
    mkdirSync(tdir, { recursive: true });
    writeFileSync(join(tdir, "sess-one.jsonl"), [user("2026-02-01T00:00:00Z", "do the thing"), asst("m1", "2026-02-01T00:00:05Z", "done")].join("\n") + "\n");
    writeFileSync(join(tdir, "sess-two.jsonl"), [user("2026-02-02T00:00:00Z", "other"), asst("m2", "2026-02-02T00:00:05Z", "ok")].join("\n") + "\n");
    writeFileSync(join(tdir, "empty.jsonl"), "");
    mkdirSync(join(tdir, "broken.jsonl"));
    const b = baselineRecords(proj, { user: "me", project: "proj" });
    eq("baseline: one record per session with usage", b.recs.map((r) => [r.session, r.kit, r.user, r.round, r.prompt]).sort(),
      [["sess-one", "baseline", "me", 1, "do the thing"], ["sess-two", "baseline", "me", 1, "other"]]);
    eq("baseline: records carry the whole session", b.recs.find((r) => r.session === "sess-one").agents[0].read, 1000);
    eq("baseline: a session that fails to collect is skipped and counted", b.skipped, 1);
    match("baseline feeds the digest", digest(b.recs, P), /^## by kit\nbaseline /m);
  } finally {
    if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevCfg;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
