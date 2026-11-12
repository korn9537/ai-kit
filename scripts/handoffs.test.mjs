// docs/handoffs.md as tests: the workflow's prompts carry each row, and the docs of the other routes name the same
// fields, so a change to one route that misses another fails here. Usage: node scripts/handoffs.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { init, next } from "./continuous.mjs";
import { merge, parse, render, resumeArgs } from "./plan.mjs";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const source = read("workflows/run-plan.js").replace("export const meta", "const meta");
const AsyncFunction = (async () => {}).constructor;
let pass = 0;
let fail = 0;
const has0 = (text, ...res) => res.every((r) => r.test(text));
const ok = (name, cond) => {
  console.log(`${cond ? "ok  " : "FAIL"} - ${name}`);
  cond ? pass++ : fail++;
};

const commit = (hash, extra = {}) => ({ hash, files: ["a"], choices: [], owner: [], blockers: [], unmet: [], notes: [], review: "review", ...extra });
const finding = (what, dataRule) => ({ where: "a.ts:1", what, rule: "r", fix: "f", verdict: "CONFIRMED", dataRule });
const review = (findings) => ({ findings, reviewed: true, checked: "all" });
const batches = [
  { id: "a", title: "feat(x): y", brief: "BRIEF-A", accept: ["CHECK-A"], risks: ["RISK-A"], tests: ["TEST-A"], verify: "make test", alsoInScope: ["SCOPE-A"] },
  { id: "b", title: "feat(x): z", brief: "BRIEF-B", risks: ["RISK-B"], tests: ["TEST-B"], waitsFor: ["a"] },
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
      if (o.label === "review: plan") return review([]);
      if (/^review/.test(o.label)) return review(reviews[n++] ?? []);
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
const DIFF = (a, b) => new RegExp(`git diff ${a}\\^\\.\\.${b} -- ':\\(literal\\)a' ':\\(exclude\\)ai/usage'`);
const ONLY_JOB = /Only this job's commits are in scope \(`git log --format=%h --grep '\^Job: 2026-11-08-x\$'/;

let { seen } = await run([[finding("bug", true)], [finding("narrow", false)], []]);
const commitA = role(seen, /^commit: \[a\]/);
ok("committer: brief, Done when, verify, Job, Batch, later batches",
  all(commitA, /BRIEF-A/, DONE, /Verify: make test/, /Job: 2026-11-08-x/, /Batch: a/, /Later batches[\s\S]*- b: feat\(x\): z/));
const firstReview = role(seen, /^review: \[job\]/);
ok("job reviewer: one, request, every batch, also in scope, Done when, the excluded range",
  firstReview.length === 1 && all(firstReview, /REQUEST/, /a: feat\(x\): y; b: feat\(x\): z/, /also in scope: SCOPE-A/, DONE, DIFF("c1", "c2"), ONLY_JOB));
const fixes = role(seen, /^commit: \[job fix\]/);
ok("fix committer: findings, brief, Done when, Job, no Batch trailer",
  fixes.length === 2 && all(fixes, /a\.ts:1/, /BRIEF-A/, DONE, /Job: 2026-11-08-x/) && fixes.every((p) => !/Batch: /.test(p)));
ok("fix committer: reads only the rule a finding names, and verifies", all(fixes, /read only the rule a finding names/, /Verify: make test/));
const rechecks = role(seen, /^review: \[job recheck\]/);
ok("fresh re-check: request, scope, Done when, the whole range", /REQUEST/.test(rechecks[0]) && /also in scope: SCOPE-A/.test(rechecks[0]) && DONE.test(rechecks[0]) && DIFF("c1", "f1").test(rechecks[0]));
ok("narrow re-check: the fix commit, the findings, Done when", /Re-check of a fix/.test(rechecks[1]) && SHOW("f2").test(rechecks[1]) && /narrow/.test(rechecks[1]) && DONE.test(rechecks[1]));

({ seen } = await run([[finding("bug")], [finding("data", true)], []]));
const second = role(seen, /^review: \[job recheck\]/)[1];
ok("second-round fresh re-check: request, scope, Done when, the whole range",
  /REQUEST/.test(second) && /also in scope: SCOPE-A/.test(second) && DONE.test(second) && DIFF("c1", "f2").test(second));

let { res } = await run([[]], { a: { unmet: ["CHECK-A not met"] } });
ok("committer unmet: batch partial, the batch that waits on it skipped",
  res.batches[0].status === "partial" && res.batches[0].unmet[0] === "CHECK-A not met" && res.batches[1].status === "skipped");
for (const k of ["owner", "blockers"]) {
  ({ res } = await run([[]], { a: { [k]: ["LEFT"] } }));
  ok(`committer ${k}: batch partial, the batch that waits on it skipped`, res.batches[0].status === "partial" && res.batches[1].status === "skipped");
}
({ res } = await run([[finding("bug")], []], { fix: { unmet: ["CHECK-A broken by the fix"] } }));
ok("fix committer unmet: the job review partial", res.review.status === "partial" && res.review.unmet.includes("CHECK-A broken by the fix"));
({ res } = await run([[finding("bug")]], { fix: { hash: "" } }));
ok("a fix that made no commit keeps its findings in confirmed", res.review.review === "CONFIRMED findings left unfixed" && res.review.confirmed.length === 1);

const pr = seen.find((x) => x.label === "review: plan")?.prompt ?? "";
ok("plan reviewer: request, per batch brief, Done when, risks, tests, also in scope, waits for",
  all([pr], /REQUEST/, /Batch a \(size normal\): feat\(x\): y/, /BRIEF-A/, DONE, /- RISK-A/, /- TEST-A/, /also in scope: SCOPE-A/, /Batch b \(size normal\): feat\(x\): z \(waits for a\)/, /BRIEF-B/));
const okPlan = { findings: [{ batches: ["a"], kind: "claim", what: "CLAIM-X", fix: "FIX-X", verdict: "CONFIRMED" }, { batches: ["a", "b"], kind: "conflict", what: "BOTH", fix: "f", verdict: "PLAUSIBLE" }, { batches: ["zz"], kind: "test", what: "LOST", fix: "f", verdict: "CONFIRMED" }], reviewed: true, checked: "c" };
{
  const seen2 = [];
  let f = 0;
  await new AsyncFunction("args", "agent", "log", source)({ plugin: "/p", job: "2026-11-08-x", request: "REQUEST", batches }, async (prompt, o) => {
    seen2.push({ label: o.label, prompt });
    if (o.label === "review: plan") return okPlan;
    if (/^review/.test(o.label)) return review([finding("bug", false)]);
    return / fix\]/.test(o.label) ? commit(`f${++f}`) : commit(o.label.includes("[a]") ? "c1" : "c2");
  }, () => {});
  const ca = role(seen2, /^commit: \[a\]/)[0], cb = role(seen2, /^commit: \[b\]/)[0];
  ok("plan findings reach each batch they name; one naming no batch reaches all", /CLAIM-X/.test(ca) && !/CLAIM-X/.test(cb) && /BOTH/.test(ca) && /BOTH/.test(cb) && /LOST/.test(ca) && /LOST/.test(cb));
  ok("the committer is told to report an unmet CONFIRMED finding in unmet", /goes in `unmet`/.test(ca));
  ok("first reviewer and re-checks get the tests and CONFIRMED findings owed",
    all(role(seen2, /^review: \[job/), /Also owed by this batch/, /test: TEST-A/, /plan review: CLAIM-X/));
  ok("fix committer gets risks, tests and the plan findings", all(role(seen2, /^commit: \[job fix\]/), /- RISK-A/, /- TEST-A/, /CLAIM-X/));
}
ok("committer: the plan's risks and tests", all(commitA, /- RISK-A/, /- TEST-A/));
ok("plan-batching names the plan review: risks, tests, claims, findings into the briefs",
  has0(read("docs/plan-batching.md"), /## Plan review/, /`risks`/, /`tests`/, /against the code when written/, /findings go into the brief of the batch they name/, /`planReview`/));
ok("reviewer: a plan review checks failure modes, tests, claims and conflicts",
  has0(read("agents/change-reviewer.md"), /A plan review/, /failure mode `risks` leaves out/, /no test in `tests`/, /the code does not make true/, /`conflict`/));
ok("run-plan.md reports the plan review", /Plan review: each `planReview` finding/.test(read("commands/run-plan.md")));

// the other routes, from their docs: each paragraph is sliced out, then every field of its row looked for in it
const pb = read("docs/plan-batching.md");
const para = (text, start, end) => {
  const i = text.indexOf(start);
  if (i < 0) return "";
  // a renamed end marker would let a field match a later paragraph: an empty slice fails the check instead
  const j = end ? text.indexOf(end, i + start.length) : text.length;
  return j < 0 ? "" : text.slice(i, j);
};
const has = (text, ...res) => text.length > 0 && res.every((r) => r.test(text));
const brief = para(pb, "- The brief (", "- It returns only");
ok("coordinator committer brief: batch, Done when, verify, job, Batch trailer, later batches, path:start-end",
  has(brief, /what to change/, /Done when/, /`risks` and `tests`/, /plan\s+review's findings/, /verify commands/, /job id/, /`Batch: <id>`/, /later batches/, /path:start-end/));
const rev = para(pb, "Reviewer brief:", "- CONFIRMED fixes");
ok("coordinator job reviewer: request, batch ids and titles, excluded range, Done when, also in scope",
  has(rev, /request/, /batches' ids and titles/, /:\(exclude\)ai\/usage'`/, /Done when/, /also in scope/));
const fixes2 = para(pb, "- CONFIRMED fixes", "- The coordinator reads");
ok("coordinator fix: by SendMessage to the batch's committer, which holds the brief", has(fixes2, /SendMessage \(it holds the context/));
ok("coordinator narrow re-check: same reviewer, fix commit, findings, Done when",
  has(fixes2, /same\s+reviewer \(SendMessage\)/, /fix commit only, with the findings and the Done\s+when checks/));
ok("coordinator fresh re-check: both commits, request, also in scope, Done when, findings",
  has(fixes2, /the whole job range\s+again with the first review's brief \(request, `also in scope`, Done when\) and its findings/));
ok("fresh fix committer: findings, every brief, Done when, no later batches", has(fixes2, /fresh fix committer\s+gets the findings, every batch's brief and Done when \(no later batches/));
const stop = para(read("hooks/review-before-stop.sh"), "Brief:", "Fix every CONFIRMED");
ok("Stop-hook reviewer: request, Done when, the job's commits, its range by file, uncommitted diff",
  has(stop, /the user's request in their\s+words/, /Done when checks/, /--grep '\^Job: <id>\$'/, /git diff <first>\^\.\.HEAD -- <files> ':\(exclude\)ai\/usage'/, /not in scope/, /git diff -- <files>/));
// per-commit review is gone: no route still names a single commit's show as the review read, or one review per commit
const routes = ["CLAUDE.core.md", "agents/change-reviewer.md", "commands/run-plan.md", "commands/continuous.md", "docs/plan-batching.md",
  "docs/handoffs.md", "docs/spec.md", "hooks/review-before-stop.sh", "workflows/run-plan.js", "README.md"];
const left = routes.filter((p) => /git show <hash> -- \.|reviewer per commit|one per commit,|review per commit|its review is clean/.test(read(p).replace(/not one per\s+commit/g, "")));
ok(`no per-commit review wording left: ${left.join(", ") || "none"}`, !left.length);
const rp = read("commands/run-plan.md");
const resume = rp.slice(rp.indexOf("4. `committed`"), rp.indexOf("5. `heldBy`"));
ok("resume reviewer: request, also in scope, accept as Done when, the excluded show",
  /request/.test(resume) && /alsoInScope/.test(resume) && /`accept` as `Done when`/.test(resume) && /:\(exclude\)ai\/usage'/.test(resume));
ok("report routes choices, notes, unmet, PLAUSIBLE, reasons and a failed fix's confirmed",
  /Done: follow-ups among the `notes`/.test(rp) && /verify\s+results among the `notes`/.test(rp) &&
  /`blocked` or `skipped` batch with its\s+`reason`/.test(rp) && /Decided: each `choices` item/.test(rp) && /`unmet` item/.test(rp) && /each PLAUSIBLE finding with/.test(rp) && /its `confirmed` where its `review` is `CONFIRMED findings left unfixed`/.test(rp));
ok("one way on after an owner answers", !/run this command again/.test(rp));
const cm = read("agents/committer.md");
ok("committer: the schema's unmet field, and the fix brief's narrow reads", /`unmet`/.test(cm) && /A fix brief \(review findings\) skips these reads/.test(cm));
ok("committer and reviewer read the conventions the change touches",
  /that the batch touches, with the files each of those says it adds to/.test(cm) &&
    /that the diff touches, with the files each of those says it adds to/.test(read("agents/change-reviewer.md")));
ok("decider takes the BA's sources as research", /business-analyst report's Owner decisions item/.test(read("agents/decider.md")));

// the plan file and both resume routes keep every batch field the workflow reads
const full = { id: "a", title: "t", brief: "BRIEF", accept: ["CHECK"], risks: ["R"], tests: ["T"], verify: "make test", waitsFor: [], alsoInScope: ["S"] };
const fields = (b) => ["title", "brief", "accept", "risks", "tests", "verify", "alsoInScope"].every((k) => JSON.stringify(b[k]) === JSON.stringify(full[k]));
const back = parse(render(merge(null, { job: "2026-11-08-x", request: "REQUEST", batches: [full] })));
ok("plan file: every batch field and the request come back", fields(back.batches[0]) && back.request === "REQUEST");
const res2 = resumeArgs(back, new Map(), "/p");
ok("resumeArgs: every batch field, request, plugin and job", fields(res2.batches[0]) && res2.request === "REQUEST" && res2.plugin === "/p" && res2.job === "2026-11-08-x");
ok("continuous init: keeps the args as given", fields(init({ ...res2 }).args.batches[0]));
const run1 = next(init({ ...res2 }), { status: "", idle: Infinity }, { commits: new Map(), loose: [], dirty: [] }, 0).step;
ok("continuous next: the run's args keep every batch field", run1.action === "run" && fields(run1.args.batches[0]));
ok("run-plan.md Args lists every batch field", /`\{id, title, brief, accept, risks, tests, verify, waitsFor, alsoInScope\}`/.test(read("commands/run-plan.md")));
const ba = read("agents/business-analyst.md");
ok("BA: 7 Done when, 8 Owner decisions with sources", /7\. \*\*Done when\*\*/.test(ba) && /8\. \*\*Owner decisions\*\*[^\n]*\n[^\n]*sources/.test(ba));
ok("summary item 6 is Done when", /6\. Done when/.test(read("CLAUDE.core.md")));
ok("committer reads core from Screen specs on, so no rule it needs drops out", /bullets from "Screen specs" on/.test(read("agents/committer.md")));
ok("reviewer: a re-check reads only the findings' rules", /A re-check of a fix[\s\S]{0,250}no step 2 pass beyond the rules the findings name/.test(read("agents/change-reviewer.md")));
ok("decider brief names the BA's Owner decisions item in CLAUDE.core.md and ask-guard.sh",
  /when BA ran, its Owner decisions item/.test(read("CLAUDE.core.md")) && /the BA's Owner decisions item and its sources/.test(read("hooks/ask-guard.sh")));

// the owner kinds have one home: a detail of the list written anywhere else is drift
const kinds = ["evident intent", "becomes permanent once published", "public contact", "production deploy", "paid service", "nobody wrote down"];
for (const p of ["CLAUDE.core.md", "agents/business-analyst.md", "agents/decider.md", "agents/committer.md", "hooks/ask-guard.sh"])
  ok(`${p} points to owner-kinds.md, restates none of it`, /owner-kinds\.md/.test(read(p)) && kinds.every((k) => !read(p).includes(k)));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
