#!/usr/bin/env node
// Next step of a /ai-kit:continuous run, from a state file that outlives /compact and the workflow's run file.
// Usage: continuous.mjs init <state> <args.json> | next <state> [failed] | started <state> <dir> <task id> | abandon <state>
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isMain } from "./is-main.mjs";
import { JOB, readRepo } from "./plan.mjs";

export const MAX_TRIES = 6;
export const RETRY_GAP = 60 * 60 * 1000;
export const HUNG_AFTER = 2 * 60 * 60 * 1000;
// ticks come every 30 minutes: a longer gap means the Mac slept, and files did not move because nothing could
export const SLEPT_AFTER = 60 * 60 * 1000;

// run-plan.js writes exactly this blocker when an agent returned nothing; a blocker it reported itself is real
const agentFailed = (r) =>
  r?.status === "blocked" && !r.owner?.length && r.blockers?.length === 1 && r.blockers[0] === "agent failed";

// a new plan on the same job keeps every result with a commit: the report lists them, a waitsFor may not name one
export function init(args, old, base = [], baseLoose = []) {
  if (old?.running || old?.launching) throw new Error("a run of this job is still going");
  if (!JOB.test(args.job || "")) throw new Error(`bad job id: ${args.job}`);
  if (!args.plugin || !args.batches?.length) throw new Error("args need plugin and batches");
  const kept = Object.fromEntries(Object.entries(old?.batches || {}).filter(([, r]) => r.hash));
  const ids = new Set(args.batches.map((b) => b.id));
  for (const b of args.batches) {
    if (/\s/.test(b.id)) throw new Error(`batch id holds a space: ${b.id}`);
    if (kept[b.id]) throw new Error(`batch id already has a commit in this job, pick a new one: ${b.id}`);
    // run-plan.js counts an id outside the run as not committed and would skip this batch, long after the user left;
    // plan.mjs write refuses a committed one too
    for (const w of b.waitsFor || []) {
      if (kept[w]?.status === "partial")
        throw new Error(`${b.id} waits for ${w}, partial: wait on the new batch id that holds the left work`);
      if (kept[w]) throw new Error(`${b.id} waits for ${w}, committed: drop it from waitsFor`);
      if (!ids.has(w)) throw new Error(`${b.id} waits for ${w}, not in this run`);
    }
  }
  return { args, base, baseLoose, batches: kept, tries: {}, pending: [], lastEnd: 0, running: false, launching: false, dir: "" };
}

// a state file of the old version holds `newdir/` and git-quoted "caf\303\251.txt" in base; a dirty path with a space
// stays quoted whatever core.quotePath says, so both sides are decoded and a base entry ending in / is a prefix
const unquote = (e) => {
  if (!/^".*"$/.test(e)) return e;
  const bytes = [];
  const esc = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 };
  const t = e.slice(1, -1);
  for (let i = 0; i < t.length; i++) {
    const m = /^[0-7]{3}/.exec(t.slice(i + 1));
    if (t[i] !== "\\") bytes.push(...Buffer.from(t[i]));
    else if (m) (bytes.push(parseInt(m[0], 8)), (i += 3));
    else (bytes.push(esc[t[i + 1]] ?? t.charCodeAt(i + 1)), i++);
  }
  return Buffer.from(bytes).toString("utf8");
};
const inBase = (base, p) => {
  const path = unquote(p);
  return base.map(unquote).some((e) => (e.endsWith("/") ? path.startsWith(e) : e === path));
};

const MAX_LOG_FAILS = 3;
// the run is known to be over (lost session, stopped report): without this, init refuses the job for good; next
// stays at stopped, so a tick that fires before the cron is deleted launches nothing
export const abandon = (state) => ({ ...state, running: false, launching: false, pending: [], abandoned: true });

// run: what the workflow left ({ status, result, idle, failed }); repo: { commits: Map of batch id → hash, loose:
// hashes of this job with no Batch trailer, dirty: paths, noStash: a stash was tried or cannot help }
export function next(state, run, repo, now = Date.now()) {
  const s = structuredClone(state);
  const slept = s.lastTick && now - s.lastTick > SLEPT_AFTER;
  s.lastTick = now;
  const stopped = (reason) => {
    const open = s.args.batches.filter((b) => s.batches[b.id]?.status !== "committed").map((b) => b.id);
    return { state: s, step: { action: "stopped", open, commits: [...repo.commits.keys()], loose: repo.loose, ...(reason && { reason }), ...(repo.logFailed && { logFailed: true }) } };
  };
  // a turn lost between `run` and `started`: a workflow may be going, and a second one would commit everything twice
  if (s.launching || s.abandoned) return stopped();
  if (s.running) {
    if (run.failed) return stopped();
    if (run.status !== "completed" || !Array.isArray(run.result?.batches)) {
      if (slept) s.startedAt = now;
      else if (run.idle >= HUNG_AFTER) return stopped();
      return { state: s, step: { action: "running" } };
    }
    for (const r of run.result.batches) s.batches[r.id] = r;
    s.running = false;
    s.lastEnd = now;
  }
  // `commits` says nothing: a batch whose agent died after its commit would look unrun, and run again
  // a log that stays unreadable ends the retries: the third failed tick tells the session to close
  s.logFails = repo.logFailed ? (s.logFails || 0) + 1 : 0;
  if (repo.logFailed) {
    const r = stopped("log");
    if (s.logFails >= MAX_LOG_FAILS) r.step.close = true;
    return r;
  }
  const done = (id) => s.batches[id]?.status === "committed";
  const retry = [];
  const again = new Set();
  const known = Object.values(s.batches).flatMap((r) => [r.hash, r.fix?.hash, r.fix2?.hash]).filter(Boolean);
  // a resumed job holds the fix commits of its lost run: none of them is this run's lost batch
  const loose = repo.loose
    .filter((h) => !(s.baseLoose || []).some((k) => k.startsWith(h) || h.startsWith(k)))
    .filter((h) => !known.some((k) => k.startsWith(h) || h.startsWith(k)));
  const dirty = repo.dirty.filter((p) => !inBase(s.base || [], p));
  const lost = (r, id) => ({ ...r, id, status: "partial", hash: repo.commits.get(id), review: "not reviewed: no agent reported this commit" });
  // plan order: a batch's waitsFor come before it, so a skipped batch sees what will run ahead of it
  for (const b of s.args.batches) {
    const r = s.batches[b.id];
    // the agent died after its commit, or the run was lost: sending the brief again would commit the batch twice
    if ((!r || agentFailed(r)) && repo.commits.has(b.id)) {
      s.batches[b.id] = lost(r, b.id);
    } else if (!r) {
      again.add(b.id);
    } else if (agentFailed(r) && loose.length) {
      // a committer that skipped the Batch trailer: which batch this commit holds is not known
      s.batches[b.id] = { ...r, blockers: [`agent failed; commit ${loose.join(", ")} of this job names no batch`] };
    } else if (agentFailed(r) && (s.tries[b.id] || 0) < MAX_TRIES) {
      retry.push(b.id);
      again.add(b.id);
    } else if (r.status === "skipped" && (b.waitsFor || []).every((w) => done(w) || again.has(w))) {
      again.add(b.id);
    }
  }
  if (!again.size) {
    const open = s.args.batches.filter((b) => !done(b.id)).map((b) => b.id);
    return { state: s, step: { action: "done", open, dirty } };
  }
  const wait = s.lastEnd + RETRY_GAP - now;
  if (s.lastEnd && wait > 0) {
    return { state: s, step: { action: "wait", minutes: Math.ceil(wait / 60000), open: [...again] } };
  }
  if (retry.length && dirty.length) {
    // a tree clean at the start: these edits are the dead agent's, and a stash keeps them for the report
    if (!(s.base || []).length && !repo.noStash) {
      const name = `continuous ${s.args.job}: left by ${retry.join(", ")}, try ${s.tries[retry[0]] || 0}`;
      s.stashes = [...(s.stashes || []), name];
      return { state: s, step: { action: "stash", name } };
    }
    // a retry on someone's edits would commit them: the try is spent and the tree gets another hour to clear
    for (const id of retry) s.tries[id] = (s.tries[id] || 0) + 1;
    s.lastEnd = now;
    return { state: s, step: { action: "wait", minutes: 60, open: [...again], dirty } };
  }
  s.pending = retry;
  s.launching = true;
  // run-plan.js treats a waitsFor id outside this run as not committed, so a committed one must leave the list
  const batches = s.args.batches
    .filter((b) => again.has(b.id))
    .map((b) => ({ ...b, waitsFor: (b.waitsFor || []).filter((w) => !done(w)) }));
  return { state: s, step: { action: "run", args: { ...s.args, batches } } };
}

// counted only once the workflow really started, so a refused call or a lost turn costs no try
export function started(state, dir, task = "", now = Date.now()) {
  const s = structuredClone(state);
  for (const id of s.pending) s.tries[id] = (s.tries[id] || 0) + 1;
  return { ...s, pending: [], running: true, launching: false, dir, task, startedAt: now, lastTick: now };
}

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
// tmp and rename: a killed write leaves the old file, not a torn one that next cannot parse
const write = (p, v) => {
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(v, null, 2)}\n`);
  renameSync(tmp, p);
};

// <session>/subagents/workflows/<runId> → <session>/workflows/<runId>.json; only `completed` is known to end a run,
// so any other status counts as running until nothing has moved for HUNG_AFTER
export function readRun(dir, since = 0, now = Date.now()) {
  let run = {};
  try {
    run = read(join(dir, "..", "..", "..", "workflows", `${basename(dir)}.json`));
  } catch {
    // not written yet
  }
  let last = since;
  try {
    for (const f of readdirSync(dir)) last = Math.max(last, statSync(join(dir, f)).mtimeMs);
  } catch {
    // no agent wrote yet
  }
  return { ...run, idle: now - last };
}

// ai/usage stays: the kit writes it all the time, and it never holds an agent's work
function stash(cwd, name) {
  try {
    const args = ["stash", "push", "--include-untracked", "-m", name, "--", ".", ":(exclude)ai/usage"];
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (isMain(import.meta.url)) {
  const [cmd, path, arg] = process.argv.slice(2);
  try {
    if (cmd === "init" && path && arg) {
      const args = read(arg);
      const { dirty, loose, logFailed } = readRepo(args.repo || process.cwd(), args.job);
      if (logFailed) throw new Error(`git log failed, the commits of ${args.job} are not known`);
      write(path, init(args, existsSync(path) ? read(path) : undefined, dirty, loose));
    } else if (cmd === "abandon" && path) {
      if (!existsSync(path)) throw new Error(`no state ${path}`);
      write(path, abandon(read(path)));
    } else if (cmd === "started" && path && arg) {
      write(path, started(read(path), arg, process.argv[5]));
    } else if (cmd === "next" && path) {
      const old = read(path);
      const run = { ...readRun(old.dir, old.startedAt), failed: arg === "failed" };
      const cwd = old.args.repo || process.cwd();
      let { state, step } = next(old, run, readRepo(cwd, old.args.job));
      if (step.action === "stash") {
        const stashed = stash(cwd, step.name);
        if (!stashed) state.stashes.pop();
        ({ state, step } = next(state, run, { ...readRepo(cwd, old.args.job), noStash: true }));
      }
      write(path, state);
      // the plan with its briefs is too long for command output, which is cut
      if (step.args) write(`${path}.args.json`, step.args);
      const { args, ...shown } = step;
      console.log(JSON.stringify(args ? { ...shown, argsFile: `${path}.args.json` } : shown));
    } else {
      console.error("usage: continuous.mjs init <state> <args.json> | next <state> [failed] | started <state> <dir> <task> | abandon <state>");
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
