// Runs workflows/run-plan.js with a fake agent(): one review for the whole job, how many fix rounds it gets, how it ends.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dirname, "..", "workflows", "run-plan.js"), "utf8").replace("export const meta", "const meta");
const AsyncFunction = (async () => {}).constructor;
const run = (batches, script) =>
  new AsyncFunction("args", "agent", "log", source)(
    { plugin: "/p", job: "2026-11-07-x", request: "r", batches },
    async (prompt, o) => script(o.label, prompt),
    () => {},
  );
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  console.log(`${cond ? "ok  " : "FAIL"} - ${name}`);
  cond ? pass++ : fail++;
};

const commit = (hash) => ({ hash, files: ["a"], choices: [], owner: [], blockers: [], notes: [], review: "review" });
const finding = (what, dataRule = false, verdict = "CONFIRMED") => ({ where: "a.ts:1", what, rule: "r", fix: "f", verdict, dataRule });
const review = (findings) => ({ findings, reviewed: true, checked: "all" });
// review results in order: first review, then each re-check; every fix commit gets the next hash
const script = (reviews, fix = (n) => commit(`f${n}`), first = commit("c1")) => {
  const log = [];
  let n = 0, f = 0;
  const fn = (label) => {
    log.push(label.split(" ")[0] + (/ fix\]/.test(label) ? " fix" : ""));
    if (label === "review: plan") return review([]);
    if (/^review/.test(label)) return review(reviews[n++] ?? []);
    return / fix\]/.test(label) ? fix(++f) : first;
  };
  fn.log = log;
  return fn;
};
const one = [{ id: "a", title: "feat(x): y", brief: "b", verify: "make test", risks: ["R"], tests: ["T"] }];
const two = [...one, { id: "b", title: "feat(x): z", brief: "b2", risks: ["R2"], tests: ["T2"] }];
const fixes = (s) => s.log.filter((l) => /fix$/.test(l)).length;

// the plan review: read before the first commit, its findings reach the batch they name, a failed one does not stop the run
{
  const planFinding = { batches: ["a"], kind: "failure-mode", what: "UAT deploy lands mid-run", fix: "compare the version after the run", verdict: "CONFIRMED" };
  const seen = [];
  const res = await run(two, (label, prompt) => {
    seen.push({ label, prompt });
    if (label === "review: plan") return { findings: [planFinding], reviewed: true, checked: "plan" };
    if (/^review/.test(label)) return review([]);
    return commit(/\[b\]/.test(label) ? "c2" : "c1");
  });
  ok("plan review runs first and reads the plan, not a commit", seen[0].label === "review: plan" && /Plan review: no code is written yet/.test(seen[0].prompt) && !/git show/.test(seen[0].prompt));
  ok("plan review prompt carries the risks and tests", /- R\b/.test(seen[0].prompt) && /- T\b/.test(seen[0].prompt));
  const c = seen.find((x) => /^commit: \[a\]/.test(x.label)).prompt;
  ok("the committer gets the risks, the tests and the plan review finding", /- R\b/.test(c) && /- T\b/.test(c) && /CONFIRMED · failure-mode · UAT deploy lands mid-run/.test(c));
  ok("the result holds the plan review findings", res.planReview.findings.length === 1 && res.batches.every((b) => b.status === "committed"));
  let asked = false;
  const solo = await run(one, (l) => {
    if (l === "review: plan") asked = true;
    return /^review/.test(l) ? review([]) : commit("c1");
  });
  ok("a one-batch plan gets no plan review", !asked && solo.planReview === "skipped: one batch");
  const down = await run(two, (label) => {
    if (label === "review: plan") throw new Error("boom");
    return /^review/.test(label) ? review([]) : commit("c1");
  });
  ok("a plan review that fails: the plan runs, the result says not reviewed", down.planReview === "not reviewed" && down.batches[0].status === "committed");
  const unread = await run(two, (label) => (label === "review: plan" ? { findings: [], reviewed: false, checked: "no repo" } : /^review/.test(label) ? review([]) : commit("c1")));
  ok("a plan review that could not read: not reviewed", unread.planReview === "not reviewed");
}

let s = script([[]]);
let r = (await run(one, s)).review;
ok("a clean review: committed, no fix", r.status === "committed" && fixes(s) === 0);

s = script([[finding("bug")], []]);
r = (await run(one, s)).review;
ok("a fix the re-check accepts: one fix", r.status === "committed" && fixes(s) === 1 && !r.fix2);

s = script([[finding("bug")], [finding("x", false, "PLAUSIBLE")]]);
r = (await run(one, s)).review;
ok("only a PLAUSIBLE left: no second fix", fixes(s) === 1);

s = script([[finding("bug", true)], [finding("new bug")], []]);
r = (await run(one, s)).review;
ok("a finding the re-check leaves: a second fix, clean", r.status === "committed" && fixes(s) === 2 && r.fix2?.hash === "f2");
ok("the batch ends with no blocker and no third-pass wording", r.blockers.length === 0 && !/no third pass/.test(r.review));

s = script([[finding("bug")], [finding("b2")], [finding("b3")]]);
r = (await run(one, s)).review;
ok("still left after the second fix: partial, no third fix", r.status === "partial" && fixes(s) === 2 && /1 CONFIRMED/.test(r.review));
ok("it says no third pass nowhere", !/no third pass/.test(r.review) && r.blockers.length === 1);

s = script([[finding("bug")], [finding("b2")]], (n) => (n === 1 ? commit("f1") : { ...commit(""), notes: ["stuck"] }));
r = (await run(one, s)).review;
ok("a second fix that fails: partial, findings left", r.status === "partial" && /CONFIRMED finding/.test(r.review) && !r.fix2);
ok("a failed second fix keeps its reason", r.notes.includes("stuck"));

s = script([[finding("bug")], [finding("b2")]], (n) => (n === 1 ? commit("f1") : { ...commit("f2"), owner: ["price?"] }));
const lost = (label) => (/recheck/.test(label) && fixes(s) === 2 ? null : s(label));
r = (await run(one, lost)).review;
ok("a second re-check that fails keeps the fix's owner decision", r.status === "partial" && r.owner.includes("price?") && /not re-checked/.test(r.review));

s = script([[finding("bug")], [finding("b2", true)], []]);
const prompts = [];
r = (await run(one, (l, p) => (prompts.push(p), s(l)))).review;
ok("a data finding left: the last re-check reads all three commits", /git diff c1\^\.\.f2/.test(prompts.at(-1)));

s = script([[finding("bug")], [finding("b2")]], (n) => commit(`f${n}`), { ...commit("c1"), owner: ["pick a price"] });
const held = await run(one, s);
ok("an owner decision open on a batch: no second fix", held.batches[0].status === "partial" && fixes(s) === 1);

// one review for the whole job, however many batches: after the last commit, over the first commit's parent to the last
{
  const labels = [];
  const prompts = [];
  let h = 0;
  const res = await run(two, (label, prompt) => {
    labels.push(label);
    prompts.push(prompt);
    if (/^review: plan/.test(label)) return review([]);
    if (/^review/.test(label)) return review([]);
    return commit(`c${++h}`);
  });
  const reviewers = labels.filter((l) => /^review/.test(l) && l !== "review: plan");
  ok("two batches: one review, after both commits", reviewers.length === 1 && labels.indexOf(reviewers[0]) > labels.lastIndexOf("commit: [b] feat(x): z"));
  ok("the review reads the whole range", /git diff c1\^\.\.c2 /.test(prompts.at(-1)) && /a: feat\(x\): y; b: feat\(x\): z/.test(prompts.at(-1)));
  ok("the result holds the job review apart from the batches", res.review.status === "committed" && res.batches.every((b) => b.review === undefined));
  const mover = await run(one, (l) => (/^review/.test(l) ? review([]) : { ...commit("c1"), review: "skip" }));
  ok("every commit skippable: no review", /skipped/.test(mover.review.review));
}

const seen = [];
s = script([[]]);
await run([{ ...one[0], accept: ["the list shows the total"] }], (l, p) => (seen.push([l, p]), s(l)));
const has = (l, p) => /Done when:\n- the list shows the total/.test(p);
ok("Done when reaches the committer and the reviewer",
  seen.some(([l]) => /^commit/.test(l)) && seen.some(([l]) => /^review/.test(l)) && seen.every(([l, p]) => has(l, p)));
seen.length = 0;
s = script([[finding("bug", true)], []]);
await run([{ ...one[0], accept: ["the list shows the total"] }], (l, p) => (seen.push([l, p]), s(l)));
ok("a data finding: the fix and the fresh re-check get Done when",
  seen.some(([l]) => / fix\]/.test(l)) && seen.some(([l]) => /recheck/.test(l)) && seen.every(([l, p]) => has(l, p)));
seen.length = 0;
s = script([[]]);
await run(one, (l, p) => (seen.push(p), s(l)));
ok("no accept: no Done when line", seen.every((p) => !/Done when:/.test(p)));

// size tiers: the committer's model and effort per batch, the job fix, maxSize, labels
{
  const runOpts = (batches, fn, extra = {}) => {
    const calls = [];
    const logs = [];
    return new AsyncFunction("args", "agent", "log", source)(
      { plugin: "/p", job: "2026-11-07-x", request: "r", batches, ...extra },
      async (prompt, o) => (calls.push({ label: o.label, prompt, o }), fn(o.label)),
      (l) => logs.push(l),
    ).then((res) => ({ res, calls, logs }));
  };
  const sz = (size) => ({ ...one[0], id: size || "none", title: `feat(x): ${size}`, ...(size === "none" ? {} : { size }) });
  const keys = (c) => Object.keys(c.o).filter((k) => k === "model" || k === "effort");
  const base = (label) => (label === "review: plan" || /^review/.test(label) ? review([]) : commit(label.replace(/\W+/g, "").slice(-6)));
  const t = await runOpts([sz("light"), sz("normal"), sz("heavy"), { ...sz("none"), size: undefined }, { ...sz("odd"), size: "huge" }], base);
  const cm = (id) => t.calls.find((c) => c.label.startsWith(`commit: [${id}]`));
  ok("light: sonnet, low", cm("light").o.model === "sonnet" && cm("light").o.effort === "low");
  ok("heavy: opus, high", cm("heavy").o.model === "opus" && cm("heavy").o.effort === "high");
  ok("normal and absent: no keys", !keys(cm("normal")).length && !keys(cm("none")).length && !("model" in cm("none").o) && !("effort" in cm("none").o));
  ok("unknown size runs as normal", !keys(cm("odd")).length && t.res.batches.at(-1).size.planned === "normal");
  ok("labels keep the commit:/review: forms", t.calls.every((c) => /^(commit: \[\w+( fix)?\] .+|review: plan|review: \[(job)( recheck)?\] .+)$/.test(c.label)));
  ok("plan review prompt names each batch's size", /Batch light \(size light\)/.test(t.calls[0].prompt) && /Batch none \(size normal\)/.test(t.calls[0].prompt) && /Batch heavy \(size heavy\)/.test(t.calls[0].prompt) && /code-level difficulty/.test(t.calls[0].prompt));
  ok("result shows size", t.res.batches[0].size.planned === "light" && t.res.batches[0].size.ran === "light");

  // job fix: size of the batches the findings fall in, heavy for a dataRule finding, fix2 one tier above, never past heavy
  const fixOpts = async (batches, reviews, extra, files = () => ["a.ts"]) => {
    let n = 0;
    const o = await runOpts(batches, (l) => (/^review/.test(l) ? review(l === "review: plan" ? [] : reviews[n++] ?? []) : { ...commit(`h${n}${l.length}${Math.random()}`.slice(0, 8)), files: files(l) }), extra);
    return { ...o, fixes: o.calls.filter((c) => / fix\]/.test(c.label)) };
  };
  const lightNormal = [sz("light"), sz("normal")];
  let f = await fixOpts(lightNormal, [[finding("d", true)], []]);
  ok("dataRule finding: first fix at heavy", f.fixes[0].o.model === "opus" && f.res.review.fix.size.planned === "heavy");
  f = await fixOpts(lightNormal, [[finding("x")], []]);
  ok("other finding: first fix at normal", !keys(f.fixes[0]).length && f.res.review.fix.size.planned === "normal");
  f = await fixOpts(lightNormal, [[finding("x")], [finding("y")], []]);
  ok("fix2 one tier above the first fix", f.fixes.length === 2 && f.fixes[1].o.model === "opus" && f.res.review.fix2.size.planned === "heavy");
  f = await fixOpts(lightNormal, [[finding("x", true)], [finding("y")], []]);
  ok("fix2 after a heavy fix stays heavy", f.fixes[1].o.model === "opus" && f.res.review.fix2.size.planned === "heavy");
  f = await fixOpts([sz("light")], [[finding("x")], [finding("y")], []]);
  ok("light job: fix light, fix2 normal", f.fixes[0].o.model === "sonnet" && !keys(f.fixes[1]).length);

  // a finding is sized by the batch that holds its file, not by the heaviest batch of the job
  const byFile = (l) => [/\[heavy\]/.test(l) ? "db/migrate.sql" : /\[normal\]/.test(l) ? "app/screen.ts" : "x.md"];
  const at = (where) => ({ ...finding("x"), where });
  f = await fixOpts([sz("heavy"), sz("normal")], [[at("app/screen.ts:12")], []], {}, byFile);
  ok("finding in a normal batch's file: fix at normal although the job has a heavy batch", !keys(f.fixes[0]).length && f.res.review.fix.size.planned === "normal");
  f = await fixOpts([sz("heavy"), sz("normal")], [[at("app/screen.ts:12"), at("./db/migrate.sql:3-9")], []], {}, byFile);
  ok("findings in two batches: the higher one", f.fixes[0].o.model === "opus" && f.res.review.fix.size.planned === "heavy");
  f = await fixOpts([sz("heavy"), sz("normal")], [[at("lib/other.ts:1")], []], {}, byFile);
  ok("finding in no batch's file: normal", !keys(f.fixes[0]).length);
  f = await fixOpts([sz("heavy"), sz("normal")], [[at("db/migrate.sql:12:5")], []], {}, byFile);
  ok("file:line:col still finds its batch", f.res.review.fix.size.planned === "heavy");
  f = await fixOpts([sz("heavy"), sz("normal")], [[at("app/screen.ts:1, db/migrate.sql:2")], []], {}, byFile);
  ok("a finding naming two files: the higher batch", f.res.review.fix.size.planned === "heavy");
  const near = { ...sz("heavy"), id: "near", brief: "change lib/data.ts", waitsFor: ["missing"] };
  f = await fixOpts([sz("normal"), near], [[at("a.ts:1")], []], {}, byFile);
  ok("a short name inside another path in a brief does not match", f.res.review.fix.size.planned === "normal");
  const never = { ...sz("light"), id: "gone", brief: "build lib/gone.ts", waitsFor: ["missing"] };
  f = await fixOpts([sz("normal"), never], [[at("lib/gone.ts:4")], []], {}, byFile);
  ok("finding on a batch never built: that batch's planned size", f.fixes[0].o.model === "sonnet" && f.res.review.fix.size.planned === "light");

  // maxSize clamps every call; the raise comes first, the clamp last
  const m = await fixOpts([sz("heavy")], [[finding("x")], [finding("y")], []], { maxSize: "normal" });
  ok("maxSize normal: heavy batch call has no keys, result shows the clamp", !keys(m.calls.find((c) => /^commit: \[heavy\]/.test(c.label))).length && m.res.batches[0].size.planned === "heavy" && m.res.batches[0].size.ran === "normal");
  ok("maxSize clamps fix and fix2 on the planned size", m.fixes.every((c) => !keys(c).length) && m.res.review.fix.size.planned === "heavy" && m.res.review.fix.size.ran === "normal" && m.res.review.fix2.size.planned === "heavy" && m.res.review.fix2.size.ran === "normal");
  ok("a clamped run is logged", m.logs.some((l) => /maxSize normal/.test(l)));
  const u = await runOpts([sz("heavy")], base, { maxSize: "bogus" });
  ok("unknown maxSize: no clamp, logged", u.calls.find((c) => /^commit/.test(c.label)).o.model === "opus" && u.logs.some((l) => /maxSize "bogus"/.test(l)));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
