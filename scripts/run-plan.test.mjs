// Runs workflows/run-plan.js with a fake agent(): which batches come back with `left`.
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
// script: first review, re-check, fix commit
const script = (first, recheck, fix = commit("f1")) => (label) => {
  if (/recheck/.test(label)) return review(recheck);
  if (/^review/.test(label)) return review(first);
  return / fix\]/.test(label) ? fix : commit("c1");
};
const one = (id = "a", verify = "make test") => [{ id, title: "feat(x): y", brief: "b", verify }];

let r = (await run(one(), script([], []))).batches[0];
ok("a clean review: committed, no left", r.status === "committed" && r.left === undefined);

r = (await run(one(), script([finding("bug")], []))).batches[0];
ok("a fix the re-check accepts: no left", r.left === undefined);

r = (await run(one(), script([finding("bug")], [finding("still", false, "PLAUSIBLE")]))).batches[0];
ok("only a PLAUSIBLE left: no left", r.left === undefined);

r = (await run(one(), script([finding("bug", true)], [finding("new bug")]))).batches[0];
ok("a CONFIRMED finding after the last review: left", r.status === "partial" && r.left?.id === "a-left");
ok("left holds the new finding, not the fixed one", /new bug/.test(r.left.brief) && !/ bug · r/.test(r.left.brief.replace("new bug", "")));
ok("left keeps verify and a fix title", r.left.verify === "make test" && r.left.title === "fix(x): y");

r = (await run(one(), script([finding("bug")], [], { ...commit(""), hash: "" }))).batches[0];
ok("a failed fix: its findings are left", r.status === "partial" && /bug/.test(r.left?.brief ?? ""));

r = (await run(one("a-left"), script([finding("bug")], [finding("again")]))).batches[0];
ok("a -left batch gets no further round", r.status === "partial" && r.left === undefined);

r = (await run([{ id: "a", title: "t", brief: "b" }], script([finding("bug")], [finding("x")]))).batches[0];
ok("no verify on the batch: none on left", !("verify" in r.left));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
