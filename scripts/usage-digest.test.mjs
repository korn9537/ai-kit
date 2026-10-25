// Tests for usage-digest.mjs: usage records to a fixed-size text digest, record loading and the local baseline.
// Usage: node scripts/usage-digest.test.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baselineRecords, digest, loadRecords } from "./usage-digest.mjs";
import { enc, modelShort } from "./usage-record.mjs";

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
      ag({ id: "r1", role: "reviewer", desc: "review", calls: 20, read: 4e6, peak: 60000, findings: { confirmed: 2, plausible: 1 } }),
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
const SECTIONS = ["totals", "by role", "per commit", "by kit", "drivers", "reviews", "costliest rounds", "outliers"];
const BASE_SECTIONS = SECTIONS.map((s) => (s === "costliest rounds" ? "costliest sessions" : s));
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
match("reviews per model", d, /opus: \d+ reviews, [\d.]+ confirmed\/review/);
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

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
