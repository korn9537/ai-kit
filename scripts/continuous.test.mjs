// Tests for continuous.mjs: which batches a continuous run sends back to run-plan, and which it leaves open.
// Usage: node scripts/continuous.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abandon, HUNG_AFTER, init as initState, MAX_TRIES, next, readRun, RETRY_GAP, SLEPT_AFTER, started } from "./continuous.mjs";

// init checks each batch as plan.mjs write does: the fixtures name only ids, so give each a title and brief
const init = (args, ...rest) =>
  initState({ ...args, batches: args.batches.map((b) => ({ title: "t", brief: "b", risks: ["r"], tests: ["t"], ...b })) }, ...rest);
import { readRepo } from "./plan.mjs";

let passed = 0;
let failed = 0;
function ok(desc, cond, out) {
  if (cond) {
    passed++;
    console.log(`ok   - ${desc}`);
  } else {
    failed++;
    console.log(`FAIL - ${desc}\n${JSON.stringify(out, null, 2)}`);
  }
}

const plan = () =>
  init({
    job: "2026-11-05-x",
    plugin: "p",
    batches: [{ id: "a" }, { id: "b", waitsFor: ["a"] }, { id: "c", waitsFor: ["b"] }, { id: "d" }],
  });
const committed = (id) => ({ id, status: "committed", hash: "abc", owner: [], blockers: [] });
const failedAgent = (id) => ({ id, status: "blocked", owner: [], blockers: ["agent failed"] });
const skipped = (id) => ({ id, status: "skipped", reason: "waits" });
const T = 100 * RETRY_GAP;
const ids = (step) => step.args.batches.map((b) => b.id);
const clean = { commits: new Map(), loose: [], dirty: [] };
const finished = (...batches) => ({ status: "completed", result: { batches }, idle: 0 });
const none = { status: "", idle: Infinity };
const live = () => started(next(plan(), none, clean, 0).state, "dir", "t", T);

const orphan = abandon({ ...plan(), running: true, launching: true, pending: ["a"] });
let untitled = "";
try { initState({ job: "2026-11-05-x", plugin: "p", batches: [{ id: "a" }] }); } catch (e) { untitled = e.message; }
ok("init refuses a batch with no title or brief, as write does", /needs a title and a brief/.test(untitled));
ok("abandon lets init take the job again", init({ job: "2026-11-05-x", plugin: "p", batches: [{ id: "n" }] }, orphan).args.batches.length === 1, orphan);
ok("an abandoned run launches nothing on a late tick", next(orphan, none, clean, T).step.action === "stopped", orphan);
ok("init clears the abandoned mark", !init({ job: "2026-11-05-x", plugin: "p", batches: [{ id: "n" }] }, orphan).abandoned);
const resumed = started(next(init({ job: "2026-11-05-x", plugin: "p", batches: [{ id: "a" }] }, undefined, [], ["fix1"]), none, clean, 0).state, "dir", "t", T);
const retried = next(resumed, finished(failedAgent("a")), { ...clean, loose: ["fix1"] }, T + RETRY_GAP);
ok("a fix commit from before the resume stops no retry", retried.step.action === "wait" && retried.step.open.join() === "a", retried);
// the job review: kept per run, and its fix commits are this job's own, not a lost batch's
{
  const one = () => started(next(init({ job: "2026-11-05-x", plugin: "p", batches: [{ id: "a" }] }), none, clean, 0).state, "dir", "t", T);
  const withReview = { status: "completed", idle: 0, result: { batches: [failedAgent("a")], review: { id: "job", fix: { hash: "jf1" }, fix2: { hash: "jf2" } } } };
  const kept = next(one(), withReview, { ...clean, loose: ["jf1", "jf2"] }, T + RETRY_GAP);
  ok("a run's job review is kept in the state for the report", kept.state.reviews?.length === 1 && kept.state.reviews[0].fix.hash === "jf1", kept);
  ok("the job review's fix commits are not loose: the failed batch is retried", kept.step.action === "wait" && kept.step.open.join() === "a", kept);
  const lostRun = next(one(), finished(failedAgent("a")), { ...clean, commits: new Map([["a", "c9"]]) }, T + RETRY_GAP);
  ok("a commit no agent reported is marked not reviewed", /not reviewed/.test(lostRun.state.batches.a.review) && lostRun.state.batches.a.hash === "c9", lostRun);
}
const sibling = next(started(next(init({ job: "2026-11-05-x", plugin: "p", batches: [{ id: "a" }] }), none, clean, 0).state, "dir", "t", T), finished(failedAgent("a")), { ...clean, loose: ["new1"] }, T + RETRY_GAP);
ok("a new commit with no batch still stops the retry", sibling.step.action === "done", sibling);

let r = next(plan(), none, clean, T);
ok("a new plan runs every batch", r.step.action === "run" && ids(r.step).length === 4, r);
ok("no try is counted for a first run", !Object.keys(started(r.state, "dir").tries).length, r);

r = next(live(), { status: "", idle: 0 }, clean, T);
ok("a run still moving: running", r.step.action === "running", r);
r = next(live(), { status: "", idle: HUNG_AFTER }, { ...clean, commits: new Map([["a", "h"]]) }, T);
ok("a run with nothing moving: stopped", r.step.action === "stopped", r);
ok("stopped names what never ran and what has a commit", r.step.open.length === 4 && r.step.commits.join() === "a", r);
r = next(live(), { status: "", idle: 0, failed: true }, clean, T);
ok("a failed workflow: stopped at once", r.step.action === "stopped", r);
r = next(live(), { status: "", idle: HUNG_AFTER }, clean, T + SLEPT_AFTER + 1);
ok("after the Mac slept: still running, idle counts anew", r.step.action === "running" && r.state.startedAt > T, r);
r = next(live(), { status: "completed", result: {}, idle: HUNG_AFTER }, clean, T + 1);
ok("a result without batches merges nothing", r.step.action === "stopped" && !Object.keys(r.state.batches).length, r);
r = next(live(), { status: "completed", result: { planReview: { findings: [{ what: "PR" }], checked: "c" }, batches: [{ id: "a", status: "committed" }] }, idle: 0 }, clean, T + 1);
ok("a run's plan review findings are kept in the state for the report", r.state.planReviews?.length === 1 && r.state.planReviews[0].findings[0].what === "PR", r);

r = next(live(), finished(...["a", "b", "c", "d"].map(committed)), clean, T);
ok("all committed: done, nothing open", r.step.action === "done" && !r.step.open.length, r);

const mixed = finished(committed("a"), failedAgent("b"), skipped("c"), committed("d"));
r = next(live(), mixed, clean, T);
ok("the first retry waits an hour from the run's end", r.step.action === "wait" && r.step.minutes === 60, r);
const tick = next(r.state, none, clean, T + RETRY_GAP);
ok("a tick after the gap runs it with its dependent", tick.step.action === "run" && ids(tick.step).join() === "b,c", tick);
ok("a committed waitsFor id leaves the list", !tick.step.args.batches[0].waitsFor.length, tick);
ok("a waitsFor id still to run stays", tick.step.args.batches[1].waitsFor.join() === "b", tick);
ok("job and other args survive", tick.step.args.job === "2026-11-05-x", tick);
ok("a try counts only once started", !tick.state.tries.b && started(tick.state, "d2").tries.b === 1, tick);
ok("the skipped batch uses no try", !started(tick.state, "d2").tries.c, tick);
const again = next(tick.state, none, clean, T + RETRY_GAP);
ok("a turn lost around the launch never starts a second run", again.step.action === "stopped", again);

const blind = next(live(), finished(committed("a"), failedAgent("b")), { ...clean, logFailed: true }, T);
ok("a failed log stops the run, no batch is sent again", blind.step.action === "stopped" && !blind.step.args, blind);
const blindDone = next(init({ job: "2026-11-05-x", plugin: "p", batches: [{ id: "a" }] }), none, { ...clean, logFailed: true }, T);
ok("a failed log is marked reason log", blind.step.reason === "log" && !next(live(), none, clean, T).step.reason, blind);
const failedBlind = next(live(), { failed: true }, { ...clean, logFailed: true }, T);
ok("a stopped step before the log check still carries logFailed", failedBlind.step.logFailed === true && !next(live(), { failed: true }, clean, T).step.logFailed, failedBlind);
let lg = init({ job: "2026-11-05-x", plugin: "p", batches: [{ id: "a" }] });
const lgSteps = [1, 2, 3].map(() => {
  const r = next(lg, none, { ...clean, logFailed: true }, T);
  lg = r.state;
  return r.step;
});
ok("the third failed log tick tells the session to close", !lgSteps[0].close && !lgSteps[1].close && lgSteps[2].close === true, lgSteps);
ok("a readable log resets the count", next(lg, none, clean, T).state.logFails === 0);
ok("a failed log never reads as done or run", blindDone.step.action === "stopped", blindDone);

const second = next(started(tick.state, "d2", "t", T + RETRY_GAP), finished(committed("b"), committed("c")), clean, T + RETRY_GAP + 1);
ok("batches of earlier runs are kept", second.step.action === "done" && !second.step.open.length, second);

let s = live();
s.tries.a = MAX_TRIES;
r = next(s, finished(failedAgent("a"), skipped("b"), skipped("c"), committed("d")), clean, T);
ok("tries used up: left open with its dependents", r.step.action === "done" && r.step.open.join() === "a,b,c", r);

const found = { ...clean, commits: new Map([["a", "abc"]]) };
r = next(live(), finished(failedAgent("a"), skipped("b"), skipped("c"), committed("d")), found, T);
ok("agent died after its commit: never sent again", r.step.action === "done" && r.state.batches.a.status === "partial", r);

ok("its hash is kept for the report", r.state.batches.a.hash === "abc", r);
r = next(init({ job: "2026-11-05-j", plugin: "p", batches: [{ id: "a" }] }), none, found, T);
ok("a commit the state does not hold: never sent again", r.step.action === "done" && r.step.open.join() === "a", r);

const dirty = { ...clean, dirty: ["f"], noStash: true };
const oldBase = (base, paths) => {
  const st = { ...live(), base };
  const x = next(st, finished(failedAgent("a"), skipped("b"), skipped("c"), committed("d")), { ...clean, dirty: paths, noStash: true }, T);
  return next(x.state, none, { ...clean, dirty: paths, noStash: true }, T + RETRY_GAP);
};
ok("an old base `newdir/` holds the files below it", oldBase(["newdir/"], ["newdir/a.txt"]).step.action === "run");
ok("an old quoted base entry matches the unquoted path", oldBase(['"caf\\303\\251.txt"'], ["café.txt"]).step.action === "run");
ok("a path outside the old base still counts", oldBase(["newdir/"], ["other/a.txt"]).step.action === "wait");
ok("a dirty path with a space, quoted by git, is in the base", oldBase(['"user notes.txt"'], ['"user notes.txt"']).step.action === "run");
ok("a quoted base dir holds a quoted path below it", oldBase(['"my dir/"'], ['"my dir/a b.txt"']).step.action === "run");
ok("a quoted path outside the base still counts", oldBase(['"user notes.txt"'], ['"other notes.txt"']).step.action === "wait");
r = next(live(), finished(failedAgent("a"), skipped("b"), skipped("c"), committed("d")), { ...dirty, noStash: false }, T);
const toStash = next(r.state, none, { ...dirty, noStash: false }, T + RETRY_GAP);
ok("a tree clean at the start: the retry stashes the edits", toStash.step.action === "stash" && toStash.state.stashes.length === 1, toStash);
r = next(r.state, none, dirty, T + RETRY_GAP);
ok("a dirty tree holds the retry and spends a try", r.step.action === "wait" && r.state.tries.a === 1, r);
const cleared = next(r.state, none, clean, T + 2 * RETRY_GAP);
ok("a tree cleaned later lets it run", cleared.step.action === "run" && ids(cleared.step).join() === "a,b,c", cleared);
s = r.state;
s.tries.a = MAX_TRIES;
r = next(s, none, dirty, T + 3 * RETRY_GAP);
ok("tries used up on a dirty tree: done, names the paths", r.step.action === "done" && r.step.dirty.join() === "f", r);
s = { ...live(), base: ["g"] };
r = next(s, finished(failedAgent("a"), skipped("b"), skipped("c"), committed("d")), { ...dirty, noStash: false }, T);
r = next(r.state, none, { ...dirty, noStash: false }, T + RETRY_GAP);
ok("a tree dirty at the start is never stashed", r.step.action === "wait" && !r.state.stashes, r);
s = { ...live(), base: ["f"] };
r = next(s, finished(failedAgent("a"), skipped("b"), skipped("c"), committed("d")), dirty, T);
r = next(r.state, none, dirty, T + RETRY_GAP);
ok("a path dirty since the start does not hold it", r.step.action === "run", r);

r = next(live(), finished(failedAgent("a"), skipped("b"), skipped("c"), committed("d")), { ...clean, loose: ["abc"] }, T + 1);
ok("a reported commit without a Batch line holds nothing", r.step.action === "wait", r);
r = next(live(), finished(failedAgent("a"), skipped("b"), skipped("c"), committed("d")), { ...clean, loose: ["fff"] }, T + 1);
ok("an unknown commit of the job: never sent again", r.step.action === "done" && r.step.open.join() === "a,b,c", r);

const partial = { id: "a", status: "partial", hash: "abc", owner: ["price?"], blockers: [] };
r = next(live(), finished(partial, skipped("b"), skipped("c"), committed("d")), clean, T);
ok("a partial batch is never committed twice", r.step.action === "done" && r.step.open.join() === "a,b,c", r);

const owner = { id: "a", status: "blocked", owner: ["price?"], blockers: ["agent failed"] };
r = next(live(), finished(owner, skipped("b"), skipped("c"), committed("d")), clean, T);
ok("an owner decision is not retried", r.step.action === "done", r);

const real = { id: "a", status: "blocked", owner: [], blockers: ["schema missing"] };
r = next(live(), finished(real, skipped("b"), skipped("c"), committed("d")), clean, T);
ok("a reported blocker is not retried", r.step.action === "done", r);

const old = { batches: { a: committed("a"), b: failedAgent("b") } };
const J = { job: "2026-11-05-j", plugin: "p" };
s = init({ ...J, batches: [{ id: "b" }] }, old);
r = next(s, none, clean, T);
ok("a new plan on the job keeps the commits only", r.step.action === "run" && r.step.args.batches.length === 1, r);
const kept = init({ ...J, batches: [{ id: "n" }] }, { batches: { p: { id: "p", status: "partial", hash: "h" } } });
ok("a partial batch with a commit is kept for the report", kept.batches.p.hash === "h", kept);
const refused = (args, prior) => {
  try {
    init(args, prior);
    return "";
  } catch (e) {
    return e.message;
  }
};
ok("a batch id reused in the job is refused", refused({ ...J, batches: [{ id: "a" }] }, old).includes("already"));
ok("a run still going is refused", refused({ ...J, batches: [{ id: "n" }] }, { running: true }).includes("still going"));
ok("a bad job id is refused", refused({ job: "x", plugin: "p", batches: [{ id: "n" }] }).includes("bad job"));
ok("a batch id with a space is refused", refused({ ...J, batches: [{ id: "n 1" }] }).includes("space"));
ok("waiting on a kept commit is refused, as plan.mjs write does", refused({ ...J, batches: [{ id: "b", waitsFor: ["a"] }] }, old).includes("committed: drop it"));
ok("waiting on an id outside the run is refused", refused({ ...J, batches: [{ id: "b", waitsFor: ["zz"] }] }, old).includes("not in this run"));
const unsure = { batches: { p: { id: "p", status: "partial", hash: "h" } } };
ok("waiting on a partial batch is refused", refused({ ...J, batches: [{ id: "n", waitsFor: ["p"] }] }, unsure).includes("partial: wait on the new batch id"));

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "continuous-")));
const dir = join(tmp, "s", "subagents", "workflows", "wf_1");
mkdirSync(dir, { recursive: true });
mkdirSync(join(tmp, "s", "workflows"));
writeFileSync(join(dir, "journal.jsonl"), "");
ok("run file not written yet: moving", readRun(dir).status === undefined && readRun(dir).idle < HUNG_AFTER);
const empty = join(tmp, "s", "subagents", "workflows", "wf_2");
mkdirSync(empty);
ok("no agent wrote yet: idle counts from the start", readRun(empty, 1000, 2000).idle === 1000);
writeFileSync(join(tmp, "s", "workflows", "wf_1.json"), JSON.stringify({ status: "completed", result: { batches: [] } }));
ok("run file read from the transcript dir", readRun(dir).status === "completed");

const repo = join(tmp, "r");
mkdirSync(repo);
const g = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
g("init", "-q");
g("config", "user.email", "t@t");
g("config", "user.name", "t");
ok("repo: no commit yet", readRepo(repo, "2026-11-05-x").commits.size === 0);
ok("repo: an unborn HEAD is not a failed log", readRepo(repo, "2026-11-05-x").logFailed === false);
const branch = g("symbolic-ref", "HEAD").trim();
mkdirSync(join(repo, ".git", "refs", "heads"), { recursive: true });
writeFileSync(join(repo, ".git", branch), "");
ok("repo: an unreadable (zero-byte) ref is a failed log", readRepo(repo, "2026-11-05-x").logFailed === true);
rmSync(join(repo, ".git", branch));
// an unborn refs/heads/<branch> beside a directory of that name (feat/x) is absent, not present
g("symbolic-ref", "HEAD", "refs/heads/feat");
mkdirSync(join(repo, ".git", "refs", "heads", "feat"), { recursive: true });
writeFileSync(join(repo, ".git", "refs", "heads", "feat", "x"), "0".repeat(40) + "\n");
ok("repo: an unborn ref beside a ref directory is not a failed log", readRepo(repo, "2026-11-05-x").logFailed === false);
rmSync(join(repo, ".git", "refs", "heads", "feat"), { recursive: true });
g("symbolic-ref", "HEAD", branch);
const nogit = join(tmp, "nogit");
mkdirSync(nogit);
ok("repo: no repo at all is a failed log", readRepo(nogit, "2026-11-05-x").logFailed === true);
g("commit", "-q", "--allow-empty", "-m", "x\n\nBatch: m4\nJob: 2026-11-05-x");
g("commit", "-q", "--allow-empty", "-m", "z\n\nBatch: longer\nJob: 2026-11-05-x-y");
g("commit", "-q", "--allow-empty", "-m", "w\n\nJob: 2026-11-05-x");
g("commit", "-q", "--allow-empty", "-m", "v\n\nBatch: m9\nJob: 2026-11-05-x\n\nCo-Authored-By: a <a@b>");
g("commit", "-q", "--allow-empty", "-m", "y\n\nBatch: other\nJob: 2026-11-05-y");
ok("repo: batches of this job only", [...readRepo(repo, "2026-11-05-x").commits.keys()].sort().join() === "m4,m9");
ok("repo: a commit with no Batch line is loose", readRepo(repo, "2026-11-05-x").loose.length === 1);
ok("repo: clean tree", !readRepo(repo, "2026-11-05-x").dirty.length);
writeFileSync(join(repo, "f"), "");
ok("repo: dirty tree", readRepo(repo, "2026-11-05-x").dirty.join() === "f");

const cli = (...a) => execFileSync("node", [join(import.meta.dirname, "continuous.mjs"), ...a], { cwd: repo, encoding: "utf8" });
const st = join(tmp, "s.json");
writeFileSync(join(tmp, "args.json"), JSON.stringify({ job: "2026-11-05-x", plugin: "p", batches: [{ id: "m4", title: "t", brief: "b", risks: ["r"], tests: ["t"] }] }));
cli("init", st, join(tmp, "args.json"));
ok("cli: a commit already in the repo is not sent again", JSON.parse(cli("next", st)).action === "done");
rmSync(st);
writeFileSync(join(tmp, "args.json"), JSON.stringify({ job: "2026-11-05-z", plugin: "p", batches: [{ id: "m5", title: "t", brief: "b", risks: ["r"], tests: ["t"] }] }));
cli("init", st, join(tmp, "args.json"));
const step = JSON.parse(cli("next", st));
ok("cli: run after init, args in a file", step.action === "run" && !step.args && existsSync(step.argsFile), step);

rmSync(st, { force: true });
writeFileSync(join(tmp, "args.json"), JSON.stringify({ job: "2026-11-05-x", plugin: "p", batches: [{ id: "m4", title: "t", brief: "b", risks: ["r"], tests: ["t"] }], repo: nogit }));
const noInit = spawnSync("node", [join(import.meta.dirname, "continuous.mjs"), "init", st, join(tmp, "args.json")], { encoding: "utf8" });
ok("cli: init stops on a failed log", noInit.status === 1 && !existsSync(st) && noInit.stderr.includes("git log failed"), noInit);

rmSync(join(repo, "f"));
rmSync(st, { force: true });
writeFileSync(join(tmp, "args.json"), JSON.stringify({ job: "2026-11-05-s", plugin: "p", batches: [{ id: "s1", title: "t", brief: "b", risks: ["r"], tests: ["t"] }] }));
cli("init", st, join(tmp, "args.json"));
const failedState = JSON.parse(readFileSync(st, "utf8"));
writeFileSync(st, JSON.stringify({ ...failedState, batches: { s1: failedAgent("s1") }, lastEnd: 1 }));
writeFileSync(join(repo, "left"), "work");
const after = JSON.parse(cli("next", st));
ok("cli: a stash clears the tree and the retry runs", after.action === "run" && !existsSync(join(repo, "left")), after);
ok("cli: the stash holds the work and is named", g("stash", "list").includes("continuous 2026-11-05-s"));
ok("cli: the state names the stash", JSON.parse(readFileSync(st, "utf8")).stashes.length === 1);

mkdirSync(join(repo, "newdir", "sub"), { recursive: true });
writeFileSync(join(repo, "newdir", "sub", "a.txt"), "");
writeFileSync(join(repo, "เอกสาร.txt"), "");
const dirtyNames = readRepo(repo, "2026-11-05-x").dirty;
ok("repo: a file under an untracked dir is listed by its path", dirtyNames.includes("newdir/sub/a.txt"), dirtyNames);
ok("repo: a Thai path is not octal-quoted", dirtyNames.includes("เอกสาร.txt"), dirtyNames);
rmSync(join(repo, "newdir"), { recursive: true });
rmSync(join(repo, "เอกสาร.txt"));

ok("cli: a write leaves no tmp file", !readdirSync(tmp).some((f) => f.endsWith(".tmp")), readdirSync(tmp));
writeFileSync(st, '{"args":');
const torn = spawnSync("node", [join(import.meta.dirname, "continuous.mjs"), "next", st], { cwd: repo, encoding: "utf8" });
ok("cli: a truncated state is one error line, not a stack", torn.status === 1 && !torn.stderr.includes("    at ") && torn.stderr.trim().split("\n").length === 1, torn);
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
