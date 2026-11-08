// docs/handoffs.md as tests: the workflow's prompts carry each row, and the docs of the other routes name the same
// fields, so a change to one route that misses another fails here. Usage: node scripts/handoffs.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const source = read("workflows/run-plan.js").replace("export const meta", "const meta");
const AsyncFunction = (async () => {}).constructor;
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  console.log(`${cond ? "ok  " : "FAIL"} - ${name}`);
  cond ? pass++ : fail++;
};

const commit = (hash, extra = {}) => ({ hash, files: ["a"], choices: [], owner: [], blockers: [], unmet: [], notes: [], review: "review", ...extra });
const finding = (what, dataRule) => ({ where: "a.ts:1", what, rule: "r", fix: "f", verdict: "CONFIRMED", dataRule });
const review = (findings) => ({ findings, reviewed: true, checked: "all" });
const batches = [
  { id: "a", title: "feat(x): y", brief: "BRIEF-A", accept: ["CHECK-A"], verify: "make test", alsoInScope: ["SCOPE-A"] },
  { id: "b", title: "feat(x): z", brief: "BRIEF-B", waitsFor: ["a"] },
];
// every prompt by role, for a plan whose batch a gets a data finding, a fix, a narrow finding, a second fix
async function run(reviews, commits = {}) {
  const seen = [];
  let n = 0;
  let f = 0;
  const res = await new AsyncFunction("args", "agent", "log", source)(
    { plugin: "/p", job: "2026-11-08-x", request: "REQUEST", batches },
    async (prompt, o) => {
      seen.push({ label: o.label, prompt });
      if (/^review/.test(o.label)) return /\[a/.test(o.label) ? review(reviews[n++] ?? []) : review([]);
      if (/ fix\]/.test(o.label)) return commit(`f${++f}`, commits.fix);
      return /\[a\]/.test(o.label) ? commit("c1", commits.a) : commit("c2");
    },
    () => {},
  );
  return { seen, res };
}
const role = (seen, re) => seen.filter((s) => re.test(s.label)).map((s) => s.prompt);
const all = (ps, ...res) => ps.length > 0 && ps.every((p) => res.every((r) => r.test(p)));
const DONE = /Done when:\n- CHECK-A/;
const SHOW = (h) => new RegExp(`git show ${h} -- \\. ':\\(exclude\\)ai/usage'`);

let { seen } = await run([[finding("bug", true)], [finding("narrow", false)], []]);
const commitA = role(seen, /^commit: \[a\]/);
ok("committer: brief, Done when, verify, Job, Batch, later batches",
  all(commitA, /BRIEF-A/, DONE, /Verify: make test/, /Job: 2026-11-08-x/, /Batch: a/, /Later batches[\s\S]*- b: feat\(x\): z/));
const firstReview = role(seen, /^review: \[a\]/);
ok("first reviewer: request, batch, also in scope, Done when, the excluded show",
  all(firstReview, /REQUEST/, /batch a: feat\(x\): y/, /also in scope: SCOPE-A/, DONE, SHOW("c1")));
const fixes = role(seen, /^commit: \[a fix\]/);
ok("fix committer: findings, brief, Done when, later batches, Job, no Batch trailer",
  fixes.length === 2 && all(fixes, /a\.ts:1/, /BRIEF-A/, DONE, /- b: feat\(x\): z/, /Job: 2026-11-08-x/) && fixes.every((p) => !/Batch: a/.test(p)));
ok("fix committer: reads only the rule a finding names", all(fixes, /read only the rule a finding names/));
const rechecks = role(seen, /^review: \[a recheck\]/);
ok("fresh re-check: request, scope, Done when, both commits", /REQUEST/.test(rechecks[0]) && /also in scope: SCOPE-A/.test(rechecks[0]) && DONE.test(rechecks[0]) && /git show c1 f1/.test(rechecks[0]));
ok("narrow re-check: the fix commit, the findings, Done when", /Re-check of a fix/.test(rechecks[1]) && SHOW("f2").test(rechecks[1]) && /narrow/.test(rechecks[1]) && DONE.test(rechecks[1]));

let { res } = await run([[]], { a: { unmet: ["CHECK-A not met"] } });
ok("committer unmet: batch partial, the batch that waits on it skipped",
  res.batches[0].status === "partial" && res.batches[0].unmet[0] === "CHECK-A not met" && res.batches[1].status === "skipped");
({ res } = await run([[finding("bug")], []], { fix: { unmet: ["CHECK-A broken by the fix"] } }));
ok("fix committer unmet: batch partial", res.batches[0].status === "partial" && res.batches[0].unmet.includes("CHECK-A broken by the fix"));
({ res } = await run([[finding("bug")]], { fix: { hash: "" } }));
ok("a fix that made no commit keeps its findings in confirmed", res.batches[0].review === "CONFIRMED findings left unfixed" && res.batches[0].confirmed.length === 1);

// the other routes, from their docs
const pb = read("docs/plan-batching.md");
ok("coordinator committer brief names Done when", /The brief: the batch[^.]{0,200}Done when/.test(pb));
ok("coordinator reviewer brief names Done when and the excluded show", /Reviewer brief: read[\s\S]{0,120}:\(exclude\)ai\/usage'`[^\n]*Done when/.test(pb));
ok("coordinator fresh re-check names Done when", /reviews both commits whole, with\n\s+the batch's Done when checks/.test(pb));
const rp = read("commands/run-plan.md");
const resume = rp.slice(rp.indexOf("4. `committed`"), rp.indexOf("5. `heldBy`"));
ok("resume reviewer: request, also in scope, accept as Done when, the excluded show",
  /request/.test(resume) && /alsoInScope/.test(resume) && /`accept` as `Done when`/.test(resume) && /:\(exclude\)ai\/usage'/.test(resume));
ok("report routes choices, unmet, PLAUSIBLE and a failed fix's confirmed",
  /Decided: each `choices` item/.test(rp) && /`unmet` item/.test(rp) && /each PLAUSIBLE finding with/.test(rp) && /`confirmed` where `review` is `CONFIRMED findings left unfixed`/.test(rp));
ok("one way on after an owner answers", !/run this command again/.test(rp));
ok("Stop-hook reviewer brief names Done when", /Done when checks/.test(read("hooks/review-before-stop.sh")));
const cm = read("agents/committer.md");
ok("committer: the schema's unmet field, and the fix brief's narrow reads", /`unmet`/.test(cm) && /A fix brief \(review findings\) skips these reads/.test(cm));
ok("committer and reviewer read the conventions the change touches",
  /that the batch touches, with the files each of those says it adds to/.test(cm) &&
    /that the diff touches, with the files each of those says it adds to/.test(read("agents/change-reviewer.md")));
ok("decider takes the BA's sources as research", /business-analyst report's Owner decisions item/.test(read("agents/decider.md")));

// the owner kinds have one home: a detail of the list written anywhere else is drift
const kinds = ["evident intent", "becomes permanent once published", "public contact"];
for (const p of ["CLAUDE.core.md", "agents/business-analyst.md", "agents/decider.md", "agents/committer.md", "hooks/ask-guard.sh"])
  ok(`${p} points to owner-kinds.md, restates none of it`, /owner-kinds\.md/.test(read(p)) && kinds.every((k) => !read(p).includes(k)));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
