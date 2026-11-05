// Tests for continuous.mjs: which batches a continuous run sends back to run-plan, and which it leaves open.
// Usage: node scripts/continuous.test.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HUNG_AFTER, init, MAX_TRIES, next, readRepo, readRun, RETRY_GAP, SLEPT_AFTER, started } from "./continuous.mjs";

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
s = init({ ...J, batches: [{ id: "b", waitsFor: ["a"] }] }, old);
r = next(s, none, clean, T);
ok("a new plan on the job keeps the commits only", r.step.action === "run" && !r.step.args.batches[0].waitsFor.length, r);
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
const unsure = { batches: { p: { id: "p", status: "partial", hash: "h" } } };
ok("waiting on a partial batch is refused", refused({ ...J, batches: [{ id: "n", waitsFor: ["p"] }] }, unsure).includes("waits"));

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
writeFileSync(join(tmp, "args.json"), JSON.stringify({ job: "2026-11-05-x", plugin: "p", batches: [{ id: "m4" }] }));
cli("init", st, join(tmp, "args.json"));
ok("cli: a commit already in the repo is not sent again", JSON.parse(cli("next", st)).action === "done");
rmSync(st);
writeFileSync(join(tmp, "args.json"), JSON.stringify({ job: "2026-11-05-z", plugin: "p", batches: [{ id: "m5" }] }));
cli("init", st, join(tmp, "args.json"));
const step = JSON.parse(cli("next", st));
ok("cli: run after init, args in a file", step.action === "run" && !step.args && existsSync(step.argsFile), step);

rmSync(join(repo, "f"));
rmSync(st);
writeFileSync(join(tmp, "args.json"), JSON.stringify({ job: "2026-11-05-s", plugin: "p", batches: [{ id: "s1" }] }));
cli("init", st, join(tmp, "args.json"));
const failedState = JSON.parse(readFileSync(st, "utf8"));
writeFileSync(st, JSON.stringify({ ...failedState, batches: { s1: failedAgent("s1") }, lastEnd: 1 }));
writeFileSync(join(repo, "left"), "work");
const after = JSON.parse(cli("next", st));
ok("cli: a stash clears the tree and the retry runs", after.action === "run" && !existsSync(join(repo, "left")), after);
ok("cli: the stash holds the work and is named", g("stash", "list").includes("continuous 2026-11-05-s"));
ok("cli: the state names the stash", JSON.parse(readFileSync(st, "utf8")).stashes.length === 1);
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
