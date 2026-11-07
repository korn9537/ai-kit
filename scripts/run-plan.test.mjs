// Runs workflows/run-plan.js with a fake agent(): how many fix rounds a batch gets, and how it ends.
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
    if (/^review/.test(label)) return review(reviews[n++] ?? []);
    return / fix\]/.test(label) ? fix(++f) : first;
  };
  fn.log = log;
  return fn;
};
const one = [{ id: "a", title: "feat(x): y", brief: "b", verify: "make test" }];
const fixes = (s) => s.log.filter((l) => /fix$/.test(l)).length;

let s = script([[]]);
let r = (await run(one, s)).batches[0];
ok("a clean review: committed, no fix", r.status === "committed" && fixes(s) === 0);

s = script([[finding("bug")], []]);
r = (await run(one, s)).batches[0];
ok("a fix the re-check accepts: one fix", r.status === "committed" && fixes(s) === 1 && !r.fix2);

s = script([[finding("bug")], [finding("x", false, "PLAUSIBLE")]]);
r = (await run(one, s)).batches[0];
ok("only a PLAUSIBLE left: no second fix", fixes(s) === 1);

s = script([[finding("bug", true)], [finding("new bug")], []]);
r = (await run(one, s)).batches[0];
ok("a finding the re-check leaves: a second fix, clean", r.status === "committed" && fixes(s) === 2 && r.fix2?.hash === "f2");
ok("the batch ends with no blocker and no third-pass wording", r.blockers.length === 0 && !/no third pass/.test(r.review));

s = script([[finding("bug")], [finding("b2")], [finding("b3")]]);
r = (await run(one, s)).batches[0];
ok("still left after the second fix: partial, no third fix", r.status === "partial" && fixes(s) === 2 && /1 CONFIRMED/.test(r.review));
ok("it says no third pass nowhere", !/no third pass/.test(r.review) && r.blockers.length === 1);

s = script([[finding("bug")], [finding("b2")]], (n) => (n === 1 ? commit("f1") : { ...commit(""), notes: ["stuck"] }));
r = (await run(one, s)).batches[0];
ok("a second fix that fails: partial, findings left", r.status === "partial" && /CONFIRMED finding/.test(r.review) && !r.fix2);
ok("a failed second fix keeps its reason", r.notes.includes("stuck"));

s = script([[finding("bug")], [finding("b2")]], (n) => (n === 1 ? commit("f1") : { ...commit("f2"), owner: ["price?"] }));
const lost = (label) => (/recheck/.test(label) && fixes(s) === 2 ? null : s(label));
r = (await run(one, lost)).batches[0];
ok("a second re-check that fails keeps the fix's owner decision", r.status === "partial" && r.owner.includes("price?") && /not re-checked/.test(r.review));

s = script([[finding("bug")], [finding("b2", true)], []]);
const prompts = [];
r = (await run(one, (l, p) => (prompts.push(p), s(l)))).batches[0];
ok("a data finding left: the last re-check reads all three commits", /git show c1 f1 f2/.test(prompts.at(-1)));

s = script([[finding("bug")], [finding("b2")]], (n) => commit(`f${n}`), { ...commit("c1"), owner: ["pick a price"] });
r = (await run(one, s)).batches[0];
ok("an owner decision open: no second fix", r.status === "partial" && fixes(s) === 1);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
