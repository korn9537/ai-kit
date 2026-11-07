// Tests for plan.mjs on real repos: the plan survives a lost session, its status comes from the commits.
// Usage: node scripts/plan.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRepo } from "./continuous.mjs";
import { close, merge, ordered, parse, planWarnings, progress, projectRoot, render, resume, resumeArgs, status, write } from "./plan.mjs";

const SCRIPT = join(import.meta.dirname, "plan.mjs");
const DOCS = join(import.meta.dirname, "check-docs.mjs");
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
const throws = (desc, fn, re) => {
  try {
    fn();
    ok(desc, false, "did not throw");
  } catch (e) {
    ok(desc, re.test(e.message), e.message);
  }
};

const JOB = "2026-11-05-invoice-export";
const args = (batches = [{ id: "a", title: "A" }, { id: "b", title: "B", waitsFor: ["a"] }, { id: "c", title: "C" }]) => ({
  request: "ส่งออกใบแจ้งหนี้ **ด่วน** 2026-11-05",
  plugin: "/plugin",
  job: JOB,
  batches: batches.map((b) => ({ title: b.id, brief: `do ${b.id}`, ...b })),
});

const plan = merge(null, args());
ok("the plugin path is not stored: it changes with each version", !("plugin" in plan), plan);
ok("render and parse round-trip", JSON.stringify(parse(render(plan))) === JSON.stringify(JSON.parse(JSON.stringify(plan))), plan);
ok("a hand-written plan parses to null", parse("# Plan x\n\n| T-1 x | todo | a |\n") === null);
ok("a broken block parses to null", parse("```json\n{nope\n```\n") === null);
ok("a brief holding a fence survives", parse(render(merge(null, args([{ id: "a", brief: "x\n```\ny" }])))).batches[0].brief === "x\n```\ny");

const long = `Change "the handlers"  so that\n\tthe codes stay ${"word ".repeat(200)}${"ส่งออกใบแจ้งหนี้".repeat(40)} ${"\"".repeat(150)} ${"😀".repeat(150)} \u0001\ud83d\u2028 `;
const wide = merge(null, { ...args([{ id: "a", title: long, brief: long, verify: long, alsoInScope: [long, "short"] }]), request: long });
const wideText = render(wide);
ok("no line of a plan with long text passes 120 characters", wideText.split("\n").every((l) => l.length <= 120), wideText);
ok("long text comes back exact", JSON.stringify(parse(wideText)) === JSON.stringify(wide), parse(wideText));
ok("a text at the width stays one string, one wider is wrapped", ["x".repeat(102), "x".repeat(103)].map((brief) => /"lines"/.test(render(merge(null, args([{ id: "a", brief }]))))).join() === "false,true");
const keyed = render(merge(null, args([{ id: "a", aVeryLongKeyNameForThisBatchField: "x".repeat(100) }])));
ok("a long key leaves its line within 120 too", keyed.split("\n").every((l) => l.length <= 120) && parse(keyed).batches[0].aVeryLongKeyNameForThisBatchField === "x".repeat(100), keyed);
const q = '"'.repeat(30);
const deep = merge(null, args([{ id: "a", notes: { why: "x".repeat(104), [q]: "y".repeat(90) }, alsoInScope: [{ why: "x".repeat(104) }], a: { b: { c: { d: "x".repeat(106) } } } }]));
const deepText = render(deep);
ok("a nested or quoted key leaves its line within 120", deepText.split("\n").every((l) => l.length <= 120), deepText);
ok("nested text comes back exact", JSON.stringify(parse(deepText)) === JSON.stringify(deep), parse(deepText));
const slug = (n) => `2026-11-05-${"j".repeat(n - 11)}`;
ok("a job of 113 characters fits 120 columns", render(merge(null, { ...args(), job: slug(113) })).split("\n").every((l) => l.length <= 120));
ok("a batch's own lines field is left alone", parse(render(merge(null, args([{ id: "a", lines: ["x"] }]))))?.batches[0].lines[0] === "x");
ok("resume args hold long text as strings", resumeArgs(parse(wideText), new Map(), "/plugin").batches[0].brief === long);
ok("a short brief stays a plain string", /"brief": "do a"/.test(render(plan)), render(plan));
ok("a plan written with one long line still parses", parse(`\`\`\`json\n${JSON.stringify(wide)}\n\`\`\`\n`)?.batches[0].brief === long);

throws("a bad job is refused", () => merge(null, { ...args(), job: "x" }), /yyyy-mm-dd/);
throws("no batches are refused", () => merge(null, args([])), /batches/);
throws("a spaced id is refused", () => merge(null, args([{ id: "a b" }])), /space/);
throws("a repeated id is refused", () => merge(null, args([{ id: "a" }, { id: "a" }])), /twice/);
throws("an unknown wait is refused", () => merge(null, args([{ id: "a", waitsFor: ["z"] }])), /not in this run/);
throws("a wait on a planned batch outside the run is refused: the workflow would skip it", () =>
  merge(merge(null, args()), args([{ id: "d", waitsFor: ["a"] }])), /not in this run/);
throws("a batch with no brief is refused", () => merge(null, { job: JOB, batches: [{ id: "a", title: "A" }] }), /title and a brief/);
throws("a batch with no title is refused", () => merge(null, { job: JOB, batches: [{ id: "a", brief: "B" }] }), /title and a brief/);
throws("a wait on a later batch is refused", () => merge(null, args([{ id: "a", waitsFor: ["b"] }, { id: "b" }])), /planned after/);
throws("a batch with a commit is refused", () => merge(null, args([{ id: "a" }]), new Map([["a", "h"]])), /already has commit/);
throws("a wait on a committed batch is refused", () =>
  merge({ batches: [{ id: "a" }] }, args([{ id: "b", waitsFor: ["a"] }]), new Map([["a", "h"]])), /drop it/);
throws("a circle is refused", () => ordered([{ id: "a", waitsFor: ["b"] }, { id: "b", waitsFor: ["a"] }]), /circle/);

const grown = merge(plan, args([{ id: "b2", title: "B2" }, { id: "c", title: "C again", waitsFor: ["b2"] }]));
ok("a merge keeps batches and adds new ones", grown.batches.length === 4, grown);
ok("a merge updates a batch by id", grown.batches.find((b) => b.id === "c").title === "C again", grown);
ok("an old batch waiting for a new one moves after it",
  grown.batches.map((b) => b.id).indexOf("b2") < grown.batches.map((b) => b.id).indexOf("c"), grown);
ok("a merge keeps the request when the args hold none", merge(plan, { ...args([{ id: "d" }]), request: "" }).request === plan.request);

const swapped = merge(plan, args([{ id: "x" }]), new Map([["a", "h"]]), true);
ok("replace drops batches with no commit and keeps those with one", swapped.batches.map((b) => b.id).join() === "a,x", swapped);

const commits = new Map([["a", "h1"]]);
const p = progress(plan, commits);
ok("progress: committed, left and ready", p.done[0].hash === "h1" && p.left.join() === "b,c" && p.ready.join() === "b,c", p);
ok("progress: a wait on a left batch is not ready", progress(plan, new Map()).ready.join() === "a,c", p);
const r = resumeArgs(plan, commits, "/new");
ok("resume args: committed batches and waits are gone", r.batches.map((b) => b.id).join() === "b,c" && !r.batches[0].waitsFor.length, r);
ok("resume args: the current plugin path", r.plugin === "/new", r);

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "plan-")));
const git = (repo, ...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const repoAt = (name) => {
  const repo = join(tmp, name);
  execFileSync("git", ["init", "-q", repo]);
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "f.txt"), "x\n");
  git(repo, "add", "f.txt");
  git(repo, "commit", "-q", "-m", "base");
  return repo;
};
const batchCommit = (repo, id, file = `${id}.txt`) => {
  writeFileSync(join(repo, file), `${id}\n`);
  git(repo, "add", file);
  git(repo, "commit", "-q", "-m", `work ${id}\n\nBatch: ${id}\nJob: ${JOB}\nCo-Authored-By: x <x@example.com>`);
};
const count = (repo) => Number(git(repo, "rev-list", "--count", "HEAD").trim());

try {
  const repo = repoAt("main");
  ok("write commits the plan", write(repo, args()).committed === true && count(repo) === 2);
  ok("the tree is clean after write", git(repo, "status", "--porcelain") === "");
  ok("the same plan again makes no commit", write(repo, args()).committed === false && count(repo) === 2);
  const longRepo = repoAt("long");
  const longArgs = args([{ id: "a", brief: long }]);
  write(longRepo, longArgs);
  ok("the same long plan again makes no commit", write(longRepo, longArgs).committed === false);
  throws("write refuses a field that would not come back", () => write(repoAt("shaped"), args([{ id: "a", notes: { lines: ["x", "y"] } }])), /shaped \{ lines \}/);
  throws("write refuses a plan that would not parse back", () => write(repoAt("typed"), args([{ id: "a", waitsFor: null }, { id: 7 }])), /parse back/);
  throws("write refuses a job too long for the file", () => write(repoAt("wide-job"), { ...args(), job: slug(114) }), /passes 120 columns/);
  const oldRepo = repoAt("old-wide");
  const oldArgs = { ...args(), job: slug(114) };
  mkdirSync(join(oldRepo, "ai", "plans"), { recursive: true });
  writeFileSync(join(oldRepo, "ai", "plans", `${oldArgs.job}.md`), render(merge(null, oldArgs)));
  git(oldRepo, "add", "ai");
  git(oldRepo, "commit", "-q", "-m", "older plan");
  ok("a plan already in the repo stays writable, however wide", write(oldRepo, oldArgs).committed === false);
  ok("a wide plan takes a new batch", write(oldRepo, { ...oldArgs, batches: [...oldArgs.batches, { id: "d", title: "D", brief: "do d" }] }).committed === true);
  const narrow = repoAt("narrow");
  write(narrow, args());
  throws("a plan already in the repo refuses a new wide line", () => write(narrow, { ...args(), batches: [{ id: "e", title: "E", brief: "do e", ["k".repeat(130)]: 1 }] }), /passes 120 columns/);
  throws("write refuses a key too long for the file", () => write(repoAt("wide-key"), args([{ id: "a", ["k".repeat(130)]: 1 }])), /passes 120 columns/);
  ok("the refused plan leaves no file", !existsSync(join(tmp, "shaped", "ai", "plans", `${JOB}.md`)));
  const rel = `ai/plans/${JOB}.md`;
  ok("the plan commit carries the job", git(repo, "log", "-1", "--format=%B").includes(`Job: ${JOB}`));
  const seen = readRepo(repo, JOB);
  ok("continuous does not count the plan commit as a loose commit", !seen.loose.length, seen);
  const docs = spawnSync("node", [DOCS, "--strict", rel], { cwd: repo, encoding: "utf8" });
  ok("check-docs passes a plan holding Thai, bold and dates", docs.status === 0, docs.stdout);

  ok("status before any batch", status(repo)[0] === `${JOB}: 0 of 3 batches committed; ready a, c; waiting b`, status(repo));
  batchCommit(repo, "a");
  ok("status follows the commits", status(repo)[0].startsWith(`${JOB}: 1 of 3 batches committed; ready b, c`), status(repo));
  ok("status of another job prints nothing", !status(repo, "2026-01-01-other").length);

  const out = resume(repo, undefined, "/plugin");
  const left = JSON.parse(readFileSync(out.argsFile, "utf8"));
  ok("resume finds the one open plan", out.job === JOB && out.left.join() === "b,c", out);
  ok("resume writes the args in the git dir, not the tree", left.batches.length === 2 && git(repo, "status", "--porcelain") === "", left);
  ok("resume names the committed batches for the reviewer", out.committed[0].id === "a", out);
  writeFileSync(join(repo, "left.txt"), "dead agent\n");
  ok("resume shows what a dead committer left", resume(repo, JOB, "/p").dirty.join() === "left.txt");
  rmSync(join(repo, "left.txt"));
  mkdirSync(join(repo, ".git", "claude-review"), { recursive: true });
  const state = join(repo, ".git", "claude-review", `continuous-${JOB}.json`);
  ok("what waits on a commit of unknown end is held", resume(repo, JOB, "/p").heldBy.b?.join() === "a", resume(repo, JOB, "/p"));
  ok("a held batch is not ready", resume(repo, JOB, "/p").ready.join() === "c", resume(repo, JOB, "/p"));
  writeFileSync(state, '{"running":true}');
  ok("resume warns of a continuous run still going", resume(repo, JOB, "/p").continuousRunning === true);
  ok("resume names the state to abandon", resume(repo, JOB, "/p").continuousState === state);
  writeFileSync(state, '{"launching":true}');
  ok("a run being launched counts as going", resume(repo, JOB, "/p").continuousRunning === true);
  writeFileSync(state, '{"batches":{"a":{"status":"partial"}}}');
  ok("a partial batch still holds what waits on it", resume(repo, JOB, "/p").heldBy.b?.join() === "a");
  writeFileSync(state, '{"batches":{"a":{"status":"committed"}}}');
  ok("a batch known to be clean holds nothing", !Object.keys(resume(repo, JOB, "/p").heldBy).length);
  rmSync(state);

  throws("close refuses with batches left", () => close(repo, JOB), /batches left: b, c/);
  ok("no finished plan yet", !planWarnings(repo).length);
  throws("write refuses a batch with a commit", () => write(repo, args([{ id: "a" }])), /already has commit/);
  ok("write adds a batch to the plan", write(repo, args([{ id: "d", title: "D" }])).committed === true);
  ok("the old batches stay", parse(readFileSync(join(repo, rel), "utf8")).batches.length === 4);

  for (const id of ["b", "c", "d"]) batchCommit(repo, id);
  ok("status says none left", status(repo)[0].endsWith("none left"), status(repo));
  ok("resume with nothing left finds the plan and gives no args file", !resume(repo, undefined, "/p").argsFile);
  ok("a finished plan is warned of", planWarnings(repo)[0]?.includes(`close ${JOB}`), planWarnings(repo));
  writeFileSync(join(repo, "staged.txt"), "someone\n");
  git(repo, "add", "staged.txt");
  throws("close refuses over someone's staged file", () => close(repo, JOB), /index holds other files/);
  ok("the refused close leaves the plan", existsSync(join(repo, rel)) && git(repo, "ls-files", rel).trim() === rel);
  ok("the refused close leaves the index as it was", git(repo, "diff", "--cached", "--name-only").trim() === "staged.txt");
  git(repo, "reset", "-q", "--", "staged.txt");
  rmSync(join(repo, "staged.txt"));
  close(repo, JOB);
  ok("close deletes the plan in a commit", !existsSync(join(repo, rel)) && git(repo, "status", "--porcelain") === "");
  ok("close carries the job", git(repo, "log", "-1", "--format=%B").includes(`Job: ${JOB}`));
  ok("no plan, no status", !status(repo).length);

  const drop = repoAt("drop");
  write(drop, args());
  ok("--drop gives up the batches left", close(drop, JOB, true).dropped.join() === "a,b,c");

  const busy = repoAt("busy");
  writeFileSync(join(busy, "staged.txt"), "someone\n");
  git(busy, "add", "staged.txt");
  throws("write refuses over someone's staged file", () => write(busy, args()), /index holds other files/);
  ok("the refused write leaves no plan", !existsSync(join(busy, rel)));
  ok("the refused write leaves the index as it was", git(busy, "diff", "--cached", "--name-only").trim() === "staged.txt");

  const hook = repoAt("hook");
  writeFileSync(join(hook, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho no way\nexit 1\n");
  execFileSync("chmod", ["+x", join(hook, ".git", "hooks", "pre-commit")]);
  throws("a failed commit is reported", () => write(hook, args()), /no way/);
  ok("a failed commit leaves no plan", !existsSync(join(hook, rel)) && git(hook, "status", "--porcelain") === "");

  const fmt = repoAt("fmt");
  write(fmt, args());
  const path = join(fmt, rel);
  writeFileSync(path, readFileSync(path, "utf8").replace(/"waitsFor": \[\n\s+"a"\n\s+\]/, '"waitsFor": ["a"]'));
  git(fmt, "add", rel);
  git(fmt, "commit", "-q", "-m", `format\n\nPlan-File: write\nJob: ${JOB}`);
  ok("a plan a formatter rewrote is the same plan: no empty commit", write(fmt, args()).committed === false);

  writeFileSync(path, readFileSync(path, "utf8").replace(/\n/g, "\r\n"));
  ok("a CRLF checkout keeps the plan", status(fmt)[0]?.startsWith(JOB), status(fmt));

  const bad = repoAt("bad");
  write(bad, args());
  writeFileSync(join(bad, "ai", "plans", "2026-01-01-broken.md"), '```json\n{"job":"2026-01-01-broken","batches":[null]}\n```\n');
  writeFileSync(join(bad, "ai", "plans", "2026-01-02-broken.md"), '```json\n{"job":"2026-01-02-broken","batches":[{"id":"a","waitsFor":"x"}]}\n```\n');
  ok("a broken plan hides no other plan", status(bad).length === 1 && status(bad)[0].startsWith(JOB), status(bad));
  ok("a broken plan does not crash check", planWarnings(bad).length === 0, planWarnings(bad));

  const slow = repoAt("slow");
  write(slow, args());
  ok("status past its budget says so, never a false count", status(slow, undefined, 1)[0] === `${JOB}: status not known`, status(slow, undefined, 1));
  const lost = repoAt("lost");
  write(lost, args());
  execFileSync("mv", [join(lost, ".git", "objects"), join(lost, ".git", "objects.away")]);
  execFileSync("mkdir", [join(lost, ".git", "objects")]);
  throws("a failed log never offers every batch again", () => resume(lost, JOB, "/p"), /git log failed|not a git|status/);
  execFileSync("rm", ["-rf", join(lost, ".git", "objects")]);
  execFileSync("mv", [join(lost, ".git", "objects.away"), join(lost, ".git", "objects")]);

  const ign = repoAt("ignored");
  writeFileSync(join(ign, ".gitignore"), "ai/plans/\n");
  throws("an ignored plan path is reported", () => write(ign, args()), /commit failed/);
  ok("the failed add leaves no plan", !existsSync(join(ign, rel)));

  const half = repoAt("half");
  mkdirSync(join(half, "ai", "plans"), { recursive: true });
  writeFileSync(join(half, rel), render(merge(null, args())));
  git(half, "add", rel);
  const staged = repoAt("staged");
  mkdirSync(join(staged, "ai", "plans"), { recursive: true });
  writeFileSync(join(staged, rel), render(merge(null, args())));
  git(staged, "add", rel);
  close(staged, JOB, true);
  ok("a plan only staged leaves no index entry when closed", git(staged, "status", "--porcelain") === "");

  const mono = repoAt("mono");
  const sub = join(mono, "app");
  mkdirSync(sub);
  write(sub, args());
  ok("a project below the top of the repo: the same plan makes no commit", write(sub, args()).committed === false);
  close(sub, JOB, true);
  ok("a project below the top of the repo: close commits", git(mono, "status", "--porcelain") === "");

  ok("a plan only staged by a killed run is committed by the next write", write(half, args()).committed === true && git(half, "ls-tree", "HEAD", rel).includes(rel));

  const hand = repoAt("hand");
  mkdirSync(join(hand, "ai", "plans"), { recursive: true });
  writeFileSync(join(hand, "ai", "plans", "x.md"), "# Plan x\n\n| task | status | files |\n|---|---|---|\n| T-1 x | done | a |\n");
  writeFileSync(join(hand, "ai", "plans", "y.md"), "# Plan y\n\n| T-1 x | done | a |\n| T-2 y | todo | b |\n");
  writeFileSync(join(hand, "ai", "plans", "z.md"), "# Plan z, no table\n");
  ok("a hand plan with only done rows is warned of, others not",
    planWarnings(hand).length === 1 && planWarnings(hand)[0].startsWith("ai/plans/x.md"), planWarnings(hand));
  ok("a hand plan gets no status line", !status(hand).length);
  throws("write refuses a hand plan's path", () => {
    writeFileSync(join(hand, rel), "# mine\n");
    write(hand, args());
  }, /not a plan this script wrote/);

  const cli = repoAt("cli");
  const file = join(tmp, "args.json");
  writeFileSync(file, JSON.stringify(args()));
  const run = (...a) => spawnSync("node", [SCRIPT, ...a], { cwd: cli, encoding: "utf8" });
  ok("cli: write", JSON.parse(run("write", file).stdout).committed === true);
  ok("cli: status", run("status").stdout.startsWith(JOB));
  const res = JSON.parse(run("resume").stdout);
  ok("cli: resume fills in the plugin root", JSON.parse(readFileSync(res.argsFile, "utf8")).plugin === join(import.meta.dirname, ".."), res);
  ok("cli: a refusal exits 1 with the reason", run("close", JOB).status === 1 && run("close", JOB).stderr.includes("batches left"));
  writeFileSync(file, JSON.stringify(args([{ id: "x" }])));
  ok("cli: write --replace", JSON.parse(run("write", file, "--replace").stdout).committed === true && run("status", "--quick").stdout.includes("0 of 1"));
  ok("cli: --drop", JSON.parse(run("close", JOB, "--drop").stdout).dropped.length === 1);
  ok("cli: no arguments is usage", run().status === 2);

  // a staged file outside the cwd still rides along with the commit, so it is refused
  const nested = repoAt("sub");
  mkdirSync(join(nested, "app"));
  mkdirSync(join(nested, "other"));
  writeFileSync(join(nested, "other", "wip.txt"), "wip\n");
  git(nested, "add", "other/wip.txt");
  const before = count(nested);
  throws("write: a file staged outside the project directory is refused", () => write(join(nested, "app"), args()), /other\/wip\.txt/);
  ok("write: that file did not ride into a commit", count(nested) === before);
  git(nested, "reset", "-q");

  // the cli from a subdirectory works on the git top
  const top = repoAt("top");
  mkdirSync(join(top, "src"));
  const inSrc = (...a) => spawnSync("node", [SCRIPT, ...a], { cwd: join(top, "src"), encoding: "utf8" });
  writeFileSync(file, JSON.stringify(args()));
  ok("cli from a subdirectory: write lands at the top", JSON.parse(inSrc("write", file).stdout).committed === true
    && existsSync(join(top, "ai", "plans", `${JOB}.md`)) && !existsSync(join(top, "src", "ai")));
  ok("cli from a subdirectory: status sees the plan", inSrc("status").stdout.startsWith(JOB));
  const kitDir = join(top, "pkg");
  mkdirSync(join(kitDir, "ai", "kit"), { recursive: true });
  ok("projectRoot: a directory holding ai/kit is its own root", projectRoot(kitDir) === kitDir);
  ok("projectRoot: a subdirectory goes to the git top", projectRoot(join(top, "src")) === top);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
