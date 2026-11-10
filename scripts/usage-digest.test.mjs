// Tests for usage-digest.mjs: usage records to a per-round record and summary line, a fixed-size text digest, loading, baseline.
// Usage: node scripts/usage-digest.test.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  baselineRecords, buildRecord, compare, dec, digest, enc, loadRecords, loadRefusals, modelShort, sameCommit, summaryLine, uniqueCommits, validRecord, weight,
} from "./lib/usage-digest.mjs";

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
// records store desc base64 and the prompt only as prompt_chars; the helper takes plain desc
const ag = (o) => ({ id: "main", role: "coordinator", model: OPUS, calls: 1, input: 0, read: 0, write_5m: 0, write_1h: 0,
  output: 0, peak: 0, tools: {}, largest_result: 0, ...o, desc: enc(o.desc ?? "") });
const rec = (o) => ({ v: 1, ts: "2026-02-01T10:00:00Z", session: "s1aaaaaa", round: 1, kit: "2.13.0", project: "p", user: "alice",
  branch: "b", duration_s: 5, commits: [], agents: [], ...o });

const recs = [
  rec({
    prompt_chars: 17, commits: ["a1b2c3d"], base_context: 31000,
    agents: [
      ag({ calls: 10, read: 8e6, peak: 90000, tools: { Read: 4 } }),
      ag({ id: "c1", role: "commit", desc: "commit: fix login", calls: 250, read: 2e7, peak: 406000, largest_result: 90000,
        tools: { "Bash:sed": 55, "Bash:grep": 70 } }),
      ag({ id: "c2", role: "commit", desc: "commit: tests", model: SONNET, calls: 5, read: 1e6, peak: 30000 }),
      ag({ id: "r1", role: "reviewer", desc: "review", effort: "medium", calls: 20, read: 4e6, peak: 60000, findings: { confirmed: 2, plausible: 1 } }),
    ],
  }),
  rec({
    ts: "2026-02-03T10:00:00Z", session: "s2bbbbbb", kit: "2.13.1", user: "bob", base_context: 48000,
    prompt_chars: 570,
    agents: [
      ag({ calls: 4, read: 1e6, peak: 50000 }),
      ag({ id: "r2", role: "reviewer", desc: "review", model: SONNET, calls: 8, read: 1e6, peak: 40000, findings: { confirmed: 1, plausible: 0 } }),
    ],
  }),
  rec({ ts: "2026-02-03T11:00:00Z", session: "s2bbbbbb", kit: "2.13.1", user: "bob", round: 2, prompt_chars: 6, agents: [ag({ calls: 2, read: 1e5, peak: 51000 })] }),
];
const d = digest(recs, P);

eq("empty", digest([], P), "no usage records");
const SECTIONS = ["totals", "by role", "per commit", "by commits per round", "by kit", "drivers", "reviews", "costliest rounds", "outliers"];
const BASE_SECTIONS = SECTIONS.filter((s) => s !== "by commits per round").map((s) => (s === "costliest rounds" ? "costliest sessions" : s));
eq("sections in order", [...d.matchAll(/^## (.+)$/gm)].map((m) => m[1]), SECTIONS);
match("role share and model within role", d, /commit 6\d% \(opus 9\d%, sonnet \d+%\)/);
match("cost per commit says it is all cost over commits, unpriced excluded", d, /all cost \/ commits ≈ \$\d.*unpriced tokens excluded/);
match("by kit cost per commit labelled", d, /^2\.13\.0 .* cost\/commits \$\d/m);
eq("no bare per-commit label left", /\$[\d.]+\/commit\b|per commit ≈/.test(d), false);
match("drivers: mean cost per agent per role", d, /^commit: 2 agents .* \$[\d.]+\/agent /m);
match("by kit compares versions", d, /2\.13\.0 .*\n2\.13\.1 /);
match("by kit: reviewer findings per review", d, /^2\.13\.0 .* 1 reviews 2 confirmed\/review 1 plausible\/review/m);
match("by kit: second kit's findings", d, /^2\.13\.1 .* 1 reviews 1 confirmed\/review 0 plausible\/review/m);
match("drivers name tool mix", d, /commit: .*Bash:sed \d+/);
match("reviews split by model and effort", d, /^opus medium: \d+ reviews, [\d.]+ confirmed\/review/m);
match("reviews: a record without effort shows the model alone", d, /^sonnet: \d+ reviews/m);
match("costliest rounds: session, round, prompt length, user, role mix, no excerpt", d, /^- \$[\d.]+ s1aaaaaa r1 17 chars alice: commit \d+% .*coordinator/m);
eq("no prompt text or excerpt separator in the rounds section", /\| |\(no prompt\)/.test(d.split("## costliest rounds")[1].split("## outliers")[0]), false);
match("outliers over 150k peak or 150 calls", d, /peak 406k|250 calls/);
match("totals cost split by token type", d, /by type: read \d+%/);
match("person and cost in totals", d, /by user: alice \$[\d.]+ \d+%, bob /);
match("base context trend", d, /base context: 2026-02 40k|base context: .*2026-02 /);
match("header counts", d, /^records 3 · sessions 2 · rounds 3 · commits 1 · 2026-02-01\.\.2026-02-03/);
eq("a round's cost spans its records (round 2 of s2 is its own round)", (d.match(/^- \$[\d.]+ \w{8} r\d+ /gm) ?? []).length, 3);
match("digest decodes an agent desc", d, /commit "commit: fix login" opus/);

// size: bounded however many records, users, kits, models and tools there are
const many = [];
for (let i = 0; i < 10000; i++) {
  many.push(rec({
    ts: `2026-0${1 + (i % 9)}-15T00:00:00Z`, session: `s${i % 700}`, round: 1 + (i % 7), kit: `2.${i % 40}.0`, user: `user-number-${i % 300}-${"n".repeat(30)}`,
    project: `proj${i % 30}`, prompt_chars: 400 + i, commits: i % 3 ? [] : [`h${i}`], base_context: 30000 + (i % 50) * 1000,
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
match("unpriced model reported apart, total through fmtTok", unk, /unpriced: 2k tok/);
match("unpriced millions read as M", digest([rec({ agents: [ag({ model: "mystery-1", read: 2.5e6 })] })], P), /unpriced: 2.5M tok/);
const onlyUnk = digest([rec({ agents: [ag({ model: "mystery-1", read: 1500 })] })], P);
match("only unpriced: no NaN, no cost", onlyUnk, /unpriced: 2k tok/);
eq("no NaN or undefined anywhere", [d, big, unk, onlyUnk].some((t) => /NaN|undefined|Infinity/.test(t)), false);

match("meta shown in the header", digest(recs, P, { bad: 2, skipped: 4, sessionsSkipped: 1 }), /^records 3 .* · 2 bad lines · 4 skipped · 1 sessions skipped\n/);
match("empty with meta", digest([], P, { bad: 2 }), /^no usage records · 2 bad lines$/);

// a malformed record handed straight to digest is skipped and counted, never thrown on
const junk = [recs[0], null, "x", { v: 1, ts: "2026-02-01T00:00:00Z", agents: [null, 3] }, { v: 2, ts: "2026-02-01", agents: [] }, { ...recs[1], agents: [{ model: 5 }] }];
let threw = false;
let dj = "";
try {
  dj = digest(junk, P);
} catch {
  threw = true;
}
eq("digest never throws on a malformed record", threw, false);
match("digest counts what it skipped", dj, /^records 1 .* · 5 skipped\n/);
eq("digest of only malformed records", digest([null, { v: 9 }], P), "no usage records · 2 skipped");
const manyTools = rec({ agents: Array.from({ length: 300000 }, (_, i) => ag({ id: `a${i}`, role: "commit", calls: i, peak: i, largest_result: i, read: 1 })) });
eq("300k agents in one role: no spread overflow", digest([manyTools], P).includes("300000 agents"), true);
eq("modelShort capped at 30", modelShort(`x${"y".repeat(100)}`).length, 30);

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
  eq("load: records, unparsable lines, unusable records", [all.recs.length, all.bad, all.skipped], [3, 1, 2]);
  const since = loadRecords(tmp, "2026-02-01");
  eq("since filters by ts, inclusive", [since.recs.map((r) => r.ts.slice(0, 10)), since.bad], [["2026-02-01", "2026-02-02"], 1]);
  eq("missing dir", loadRecords(join(tmp, "nope")), { recs: [], bad: 0, skipped: 0 });
  mkdirSync(join(tmp, "decisions", "2026-02"), { recursive: true });
  writeFileSync(join(tmp, "decisions", "2026-02", "s.jsonl"), '{"ts":"2026-02-03T00:00:00Z","verdict":"DECIDED"}\n');
  eq("decisions/ (the decider log) is not read as token records", loadRecords(tmp).skipped, 2);
  writeFileSync(join(tmp, "2026-02", "c.jsonl"), [
    JSON.stringify({ ...rec({}), v: 2 }), JSON.stringify(rec({ agents: ["x"] })), JSON.stringify(rec({ agents: [null] })),
    JSON.stringify(rec({ agents: [ag({ model: 7 })] })), JSON.stringify(rec({ agents: [ag({ read: "9" })] })), JSON.stringify(rec({ agents: [ag({ model: undefined })] })),
    JSON.stringify(rec({ ts: "2026-02-09T00:00:00Z" })),
  ].join("\n"));
  const withBad = loadRecords(join(tmp, "2026-02"));
  eq("records with wrong v or malformed agents are skipped and counted", [withBad.recs.length, withBad.skipped], [3, 6]);

  // the CLI: a --since that leaves nothing says so, apart from a project with no records at all
  const cli = (project, ...args) => spawnSync("node", [join(import.meta.dirname, "usage.mjs"), "digest", ...args],
    { env: { ...process.env, CLAUDE_PROJECT_DIR: project }, encoding: "utf8" }).stdout.trim();
  const withRecs = join(tmp, "withrecs");
  mkdirSync(join(withRecs, "ai", "usage", "2026-02"), { recursive: true });
  writeFileSync(join(withRecs, "ai", "usage", "2026-02", "s.1.jsonl"), line({ ts: "2026-02-01T00:00:00Z" }));
  mkdirSync(join(tmp, "norecs"), { recursive: true });
  eq("digest --since after every record: says no records since the date", cli(withRecs, "--since", "2099-01-01"), "no records since 2099-01-01");
  eq("digest on a project with no records still says no usage records", [cli(join(tmp, "norecs")), cli(join(tmp, "norecs"), "--since", "2099-01-01")], ["no usage records", "no usage records"]);
  match("digest --since before the records prints the digest", cli(withRecs, "--since", "2026-01-01"), /^records 1 /);

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
    writeFileSync(join(tdir, "sess-three.jsonl"), [user("2026-02-03T00:00:00Z", "first ask"), asst("m3", "2026-02-03T00:00:05Z", "ok"),
      user("2026-02-03T00:01:00Z", "second ask"), asst("m4", "2026-02-03T00:01:05Z", "ok")].join("\n") + "\n");
    mkdirSync(join(tdir, "broken.jsonl"));
    const b = baselineRecords(proj, { user: "me", project: "proj" });
    eq("baseline: one record per session with usage, round = prompt count, prompt = the first prompt",
      b.recs.map((r) => [r.session, r.kit, r.user, r.round, r.prompt_chars, "prompt" in r]).sort(),
      [["sess-one", "baseline", "me", 1, 12, false], ["sess-three", "baseline", "me", 2, 9, false], ["sess-two", "baseline", "me", 1, 5, false]]);
    eq("baseline: records carry the whole session", b.recs.find((r) => r.session === "sess-one").agents[0].read, 1000);
    eq("baseline: a session that fails to collect is skipped and counted", b.skipped, 1);
    const bd = digest(b.recs, P, { source: "baseline", sessionsSkipped: b.skipped });
    match("baseline feeds the digest", bd, /^## by kit\nbaseline /m);
    match("baseline header says what a record is", bd, /^baseline: 1 record = 1 session · records 3 · commits 0 · .* · 1 sessions skipped\n/);
    eq("baseline sections: sessions, not rounds", [...bd.matchAll(/^## (.+)$/gm)].map((m) => m[1]), BASE_SECTIONS);
    match("baseline session line shows session, prompt count and first prompt length", bd, /^- \$[\d.]+ sess-thr 2p 9 chars me: coordinator 100%$/m);
    eq("baseline: no per-round or r<n> labels", /per round|\br\d+ \d+ chars|\/round|\dr /.test(bd), false);
    match("baseline by kit per session", bd, /^baseline · 3s · \$[\d.]+ · \$[\d.]+\/session /m);
    eq("non-baseline digest keeps rounds", /^## costliest rounds$/m.test(d) && !/costliest sessions/.test(d), true);
  } finally {
    if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevCfg;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const okRec = { v: 1, ts: "t", agents: [] };
eq("a record whose commits hold a non-string or a too-short hash is invalid",
  [["abc1234"], [123], [null], [""], ["abc"]].map((commits) => validRecord({ ...okRec, commits })), [true, false, false, false, false]);

// ---- records and summary line ----
{
  const agent = (o) => ({ id: "main", role: "coordinator", desc: "", model: "claude-x-1", calls: 0, input: 0, read: 0,
    write_5m: 0, write_1h: 0, output: 0, peak: 0, tools: {}, largest_result: 0, ...o });
  const main1 = agent({ calls: 3, input: 3, read: 900, write_1h: 50, output: 10, peak: 953, tools: { "Bash:git": 1, Read: 2 }, largest_result: 5000 });
  const sub = agent({ id: "x1", effort: "medium", role: "commit", desc: "commit: foo", model: "claude-y-1", calls: 1, input: 1, write_5m: 3, write_1h: 4, output: 5, peak: 8 });
  const session = {
    firstTs: "2026-01-01T00:00:00Z", baseContext: 953, agents: { main: main1, x1: sub },
    prompts: [{ round: 1, ts: "2026-01-01T00:00:00Z", chars: 28 }], commits: [],
  };
  const session2 = {
    ...session,
    agents: { main: agent({ calls: 5, input: 4, read: 1300, write_1h: 80, output: 25, peak: 1500, tools: { "Bash:git": 1, Read: 3 }, largest_result: 7000 }), x1: sub },
    prompts: [...session.prompts, { round: 2, ts: "2026-01-01T00:10:00Z", chars: 6 }],
    commits: [{ ts: "2026-01-01T00:10:30Z", hash: "a1b2c3d" }],
  };
  const ctx = { now: new Date("2026-01-01T00:01:00Z"), kit: "2.0.0", project: "p", user: "u", branch: "b", session: "s1" };
  const ctx2 = { ...ctx, now: new Date("2026-01-01T00:11:30Z") };
  const prices = { "claude-x": 2 };

  const r1 = buildRecord(session, [], ctx);
  const r2 = buildRecord(session2, [r1], ctx2);
  const readOf = (r) => r.agents.reduce((n, a) => n + a.read, 0);
  eq("effort is kept in the stored record, absent when empty", [r1.agents.find((a) => a.id === "x1").effort, "effort" in r1.agents.find((a) => a.id === "main")], ["medium", false]);
  const resumed = buildRecord(session2, [r1], ctx2);
  const all = [r1, resumed, buildRecord(session2, [r1, resumed], ctx2)].filter(Boolean);

  eq("first record = whole session", r1.agents.find((a) => a.id === "main").read, 900);
  eq("delta subtracts prior records; unchanged agent omitted, zero tool keys dropped",
    [r2.agents.find((a) => a.id === "main").read, r2.agents.map((a) => a.id), r2.agents[0].tools], [400, ["main"], { Read: 1 }]);
  eq("nothing new → null", buildRecord(session2, [r1, r2], ctx2), null);
  eq("resume after cache loss: no double count", all.reduce((n, r) => n + readOf(r), 0), 1300);
  eq("round = number of prompts so far", r2.round, 2);
  eq("the record holds the prompt's length, never its text", [r1.prompt_chars, "prompt" in r1], [28, false]);
  eq("the plain desc is not in the record line; desc is base64 cut to 200 code points",
    [JSON.stringify(r1).includes("commit: foo"), dec(r1.agents[1].desc),
      [...dec(buildRecord({ ...session, agents: { x1: { ...sub, desc: "ก".repeat(300) } } }, [], ctx).agents[0].desc)].length], [false, "commit: foo", 200]);
  eq("commits only in this round", r2.commits, ["a1b2c3d"]);
  eq("duration from the round's prompt", r2.duration_s, 90);
  eq("base_context only on the first record", ["base_context" in r1, "base_context" in r2], [true, false]);
  eq("no cost fields", JSON.stringify(r1).includes("cost"), false);
  eq("weight", weight({ model: "claude-x-1", input: 1e6, read: 1e6, write_5m: 0, write_1h: 0, output: 1e5 },
    { "claude-x": 2 }), 2 * (1 + 0.1 + 0.5));
  eq("5.5 model reads at 0.05 of base input", weight({ model: "claude-opus-5-5-20260101", read: 1e6 }, { "claude-opus-5-5": 4 }), 4 * 0.05);
  eq("unpriced model", weight({ model: "other" }, {}), null);
  match("summary line", summaryLine(r2, [r1, r2], prices), /^tokens this round .* \| peak \d+k \| top: /);
  match("summary line: the session's input-equivalent tokens next to its cost", summaryLine(r2, [r1, r2], prices), /\| session ≈ \$[^|]* \(in-eq [\d.]+[kM]?\)$/);
  const longRec = { agents: [agent({ desc: enc("x".repeat(80)), model: "claude-x-1", calls: 3, read: 5e6, output: 1e5 }),
    agent({ id: "m", role: "coordinator", model: "claude-opus-5-5", calls: 2, read: 9e6, output: 3e5 }),
    ...["commit", "reviewer", "ba"].map((role, i) => agent({ id: `s${i}`, role, model: "claude-y-2", calls: 1, read: 4e6 * (i + 1) }))] };
  match("a long line drops the round's in-eq before the session's", summaryLine(longRec, [longRec], prices),
    /^tokens this round ≈ \$[^(|]*: .*\| session ≈ \$[^|]* \(in-eq [\d.]+[kM]?\)$/);
  eq("summary line with money false: tokens only, no $", (() => { const l = summaryLine(r2, [r1, r2], prices, { money: false });
    return [/^tokens this round ≈ in-eq [\d.]+[kM]?: /.test(l), /session ≈ in-eq [\d.]+[kM]?$/.test(l), l.includes("$")]; })(), [true, true, false]);

  // several records in one round: durations add up to the round's wall time, only the first carries the prompt
  const sessionMore = { ...session, agents: { main: { ...main1, read: 1000 }, x1: sub } };
  const rA = buildRecord(session, [], ctx);
  const rB = buildRecord(sessionMore, [rA], { ...ctx, now: new Date("2026-01-01T00:03:00Z") });
  eq("same round: durations sum to the round's wall time", [rA.round, rB.round, rA.duration_s + rB.duration_s], [1, 1, 180]);
  eq("prompt_chars only on the first record of a round", ["prompt_chars" in rA, "prompt_chars" in rB], [true, false]);

  const long = { ...agent({ desc: enc(`a long\n   description ${"x".repeat(100)}`), calls: 99999, read: 9e12, output: 9e12, peak: 9e8 }) };
  const opus = { ...long, model: "claude-opus-5-5" };
  const big = { agents: [opus, { ...opus, id: "c", role: "commit", model: "q" }, { ...opus, id: "r", role: "reviewer" }, { ...opus, id: "b", role: "ba", model: "q" }] };
  const capped = summaryLine(big, [big, big, big], { "claude-opus-5-5": 4 });
  eq("summary part capped at 200 characters; in-eq dropped when desc shrink is not enough", [[...capped].length <= 200, capped.includes("in-eq")], [true, false]);
  eq("desc collapsed to one line", [capped.includes("\n"), summaryLine({ agents: [agent({ desc: enc("a\n\nb"), calls: 1, read: 5 })] }, [], prices).includes("top: a b ")], [false, true]);

  let threw = false;
  try {
    buildRecord(session, [], { ...ctx, session: undefined });
  } catch {
    threw = true;
  }
  eq("no session id throws", threw, true);
  eq("session id taken from a prior record", buildRecord(sessionMore, [rA], { ...ctx, session: undefined }).session, "s1");
  eq("a commit a prior record spelled shorter is not counted again",
    buildRecord({ ...session, commits: [{ ts: "t", hash: "abc12345" }, { ts: "t", hash: "def5678" }] }, [{ ...r1, agents: [], commits: ["abc1234"] }], ctx).commits, ["def5678"]);
  // comparisons, not wall time: any timing of this failed under load; prefixes spread like real hashes, and three share
  // one so the count is above 0, which shows the comparisons went through the counter
  const hashes = (k) => Array.from({ length: k }, (_, i) => (Math.imul(i + 1, 2654435761) >>> 0).toString(16).padStart(8, "0"));
  const compares = (k) => {
    let n = 0;
    uniqueCommits([...hashes(k), "abcdef01", "abcdef02", "abcdef03"], (a, b) => (n++, sameCommit(a, b)));
    return n;
  };
  eq("uniqueCommits: 10000 distinct hashes stay distinct", uniqueCommits(hashes(10000)).length, 10000);
  eq("uniqueCommits: a hash is compared only within its prefix, not with every other", (() => { const n = compares(10000); return n > 0 && n < 10000; })(), true);
  eq("uniqueCommits: one commit per prefix family, the longest spelling kept", uniqueCommits(["abc1234", "abc12345", "def5678"]), ["abc12345", "def5678"]);
  eq("duplicate commit hashes collapse", buildRecord({ ...session, commits: [{ ts: "t", hash: "abc1234" }, { ts: "t", hash: "abc1234" }] }, [], ctx).commits, ["abc1234"]);
}

// ---- by commits per round ----
{
  const hx = (i) => `${String(i).padStart(7, "0")}`;
  let n = 0;
  const hs = (k) => Array.from({ length: k }, () => hx(++n));
  const mk = (sess, round, kit, k, o = {}) => rec({ session: sess, round, kit, commits: hs(k), agents: [ag({ model: o.model ?? OPUS, read: 1e6 }), ...(k ? [ag({ id: "c", role: "commit", read: 1e6, model: o.model ?? OPUS })] : [])] });
  const rr = [mk("sa", 1, "1.0.0", 0), mk("sb", 1, "1.0.0", 1), mk("sc", 1, "2.0.0", 3), mk("sd", 1, "2.0.0", 5), mk("se", 1, "2.0.0", 9)];
  const g = digest(rr, P);
  const lines = g.split("\n");
  const sec = lines.slice(lines.indexOf("## by commits per round") + 1, lines.indexOf("## by kit"));
  eq("commit buckets: one line per bucket plus the note", sec.map((l) => l.split(" ")[0]), ["0", "1", "2-3", "4-7", "8+", "commits"]);
  match("bucket 1", sec[1], /^1 commits: 1 rounds · \$0\.40 · 1 commits · cost\/commit \$0\.40 · reviewer 0% · coordinator 50% · commit 50%$/);
  match("bucket 2-3", sec[2], /^2-3 commits: 1 rounds · \$0\.40 · 3 commits · cost\/commit \$0\.13 /);
  match("bucket 4-7", sec[3], /^4-7 commits: 1 rounds · \S+ · 5 commits · cost\/commit /);
  match("bucket 8+", sec[4], /^8\+ commits: 1 rounds · \S+ · 9 commits · cost\/commit /);
  match("bucket 0 gives its share of cost", sec[0], /^0 commits: 1 rounds · \$0\.20 · 0 commits · 11% of cost · reviewer 0% · coordinator 100% · commit 0%$/);
  match("by kit 1.0.0 commit-round figure", g, /^1\.0\.0 · .* commit rounds cost\/commit \$\d+\.\d\d · no-commit rounds \d+% of cost$/m);
  match("by kit 2.0.0 commit-round figure", g, /^2\.0\.0 · .* commit rounds cost\/commit \$\d+\.\d\d · no-commit rounds 0% of cost$/m);
  eq("baseline digest has no such section", /by commits per round|commit rounds/.test(digest(rr, P, { source: "baseline" })), false);
  const z = digest([mk("sa", 1, "1.0.0", 0)], P);
  eq("no commits: only the 0 bucket", z.split("\n").filter((l) => /^\S+ commits: /.test(l)).length, 1);
  const up = digest([mk("sa", 1, "1.0.0", 2, { model: "unknown-model" })], P);
  eq("zero priced cost with commits prints unpriced, no NaN", [/NaN/.test(up), /2-3 commits: .*cost\/commit unpriced/.test(up)], [false, true]);
  const dup = digest([rec({ session: "sa", commits: ["abc1234"], agents: [ag({ read: 1e6 })] }), rec({ ts: "2026-02-02T10:00:00Z", session: "sb", commits: ["abc12345"], agents: [ag({ read: 1e6 })] })], P);
  match("a commit seen in two rounds counts once, header and buckets agree", dup, /commits 1 · /);
  match("the one commit sits in one round", dup, /^1 commits: 1 rounds .* · 1 commits · /m);
  match("the other round is a 0 round", dup, /^0 commits: 1 rounds /m);
}

// refusals section and kit comparison
{
  const dir = mkdtempSync(join(tmpdir(), "usage-refusals-"));
  try {
    const rf = (ts, rule, kit) => ({ v: 1, ts, rule, kit, branch: "b" });
    mkdirSync(join(dir, "refusals", "2026-02"), { recursive: true });
    mkdirSync(join(dir, "2026-02"), { recursive: true });
    const lines = [rf("2026-02-01T10:00:00Z", "pre-commit.comments", "2.45.1"), rf("2026-02-01T10:01:00Z", "pre-commit.comments", "2.46.0"),
      rf("2026-02-01T10:02:00Z", "commit-msg.job", "2.46.0")].map((r) => JSON.stringify(r));
    writeFileSync(join(dir, "refusals", "2026-02", "a.jsonl"), `${lines.join("\n")}\nnot json\n`);
    writeFileSync(join(dir, "refusals", "2026-02", "b.jsonl"), `${lines[0]}\n`);
    writeFileSync(join(dir, "2026-02", "s.jsonl"), `${JSON.stringify(rec({}))}\n`);
    const refusals = loadRefusals(dir);
    eq("refusals load, a duplicate line counts once", refusals.length, 3);
    eq("refusal files are not token records", loadRecords(dir).recs.length, 1);
    const sec = digest([rec({})], P, { refusals }).split("\n");
    const at = sec.indexOf("## refusals");
    eq("refusals section counted per rule", sec[at + 1], "3 refusals · per rule: pre-commit.comments 2, commit-msg.job 1");
    eq("and per kit", sec[at + 2], "per kit: 2.45.1 1, 2.46.0 2");
    eq("no refusals: the section says none", digest([rec({})], P, { refusals: [] }).includes("## refusals\nnone"), true);
    eq("old digests without refusals still digest", digest([rec({})], P).includes("## refusals"), false);

    const kr = (kit, session, cost, commits, extra = {}) => rec({ kit, session, commits, agents: [
      ag({ id: "main", peak: cost * 1000, tools: { Read: 4, Grep: 2 }, input: cost * 1e6 }),
      ag({ id: "c1", role: "commit", calls: 10, model: SONNET }), ...(extra.agents ?? [])] });
    const cmp = (a, b, rr = refusals) => compare([kr("2.45.1", "sa", 1, ["aaaaaaa"]), kr("2.46.0", "sb", 2, ["bbbbbbb", "ccccccc"])], rr, P, a, b);
    const out = cmp("2.45", "2.46").split("\n");
    eq("compare names both kits", out[0].startsWith("compare kit 2.45 vs 2.46"), true);
    eq("compare: sessions column and change", out.find((l) => l.startsWith("sessions:")), "sessions: 1 | 1 | +0%");
    match("compare: cost per round doubles", out.find((l) => l.startsWith("cost/round:")), /^cost\/round: \$\d+\.\d\d \| \$\d+\.\d\d \| \+100%$/);
    eq("compare: committer calls per commit", out.find((l) => l.startsWith("committer calls/commit:")), "committer calls/commit: 10 | 5 | -50%");
    eq("compare: Read+Grep per round", out.find((l) => l.startsWith("Read+Grep/round:")), "Read+Grep/round: 6 | 6 | +0%");
    eq("compare: refusals per commit by kit", out.find((l) => l.startsWith("refusals/commit:")), "refusals/commit: 1 | 1 | +0%");
    eq("compare: no reviews is n/a", out.find((l) => l.startsWith("confirmed/review:")), "confirmed/review: n/a | n/a | n/a");
    eq("a full version matches only itself", cmp("2.45.1", "2.46.0").split("\n")[0].startsWith("compare kit 2.45.1 vs 2.46.0"), true);
    match("an unknown version is named", cmp("2.45", "2.9"), /^unknown kit version 2\.9: no records; known: 2\.45\.1, 2\.46\.0$/);
    eq("a prefix is not a substring", cmp("2.4", "2.46").startsWith("unknown kit version 2.4:"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
