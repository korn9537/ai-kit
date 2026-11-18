#!/usr/bin/env node
// Queue state of /ai-kit:continuous queue: jobs in order, current job, outcomes, approvals.
// Usage: queue.mjs file | init <qfile> <job...> | next <qfile> <job> <outcome> | show|end <qfile> | approve|check <qfile> <job> <item...>
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { reviewDir } from "./lib/state-dirs.mjs";
import { JOB } from "./plan.mjs";

export const OUTCOMES = ["clean", "open", "stopped"];
export const queueFile = (cwd) => join(reviewDir(cwd, { throws: true }), "continuous-queue.json");
export const stateOf = (qfile, job) => join(qfile.replace(/[^/\\]*$/, ""), `continuous-${job}.json`);

export function init(jobs, old) {
  if (old && !old.ended) throw new Error("a queue is still going; `queue.mjs end <qfile>` gives it up");
  if (!jobs.length) throw new Error("no jobs");
  for (const j of jobs) if (!JOB.test(j || "")) throw new Error(`bad job id: ${j}`);
  if (new Set(jobs).size !== jobs.length) throw new Error("a job is named twice");
  return { jobs, current: 0, outcomes: {}, approved: {}, ended: false };
}

// the step the session acts on: the current job (its state file may not exist yet), or the end
export function step(q, qfile) {
  if (q.ended || q.current >= q.jobs.length) {
    return { action: "end", ran: q.jobs.filter((j) => q.outcomes[j]), notRun: q.jobs.filter((j) => !q.outcomes[j]) };
  }
  const job = q.jobs[q.current];
  return { action: "job", job, state: stateOf(qfile, job) };
}

// only the current job's outcome counts: a repeated call, or one for another job, moves nothing and returns the step
export function next(q, qfile, job, outcome) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`outcome is one of ${OUTCOMES.join(", ")}`);
  if (q.ended || job !== q.jobs[q.current]) return { queue: q, step: step(q, qfile) };
  const s = structuredClone(q);
  s.outcomes[job] = outcome;
  if (outcome === "clean" && s.current + 1 < s.jobs.length) s.current++;
  else s.ended = true;
  return { queue: s, step: step(s, qfile) };
}

export const end = (q) => ({ ...q, ended: true });

export function approve(q, job, items) {
  if (!q.jobs.includes(job)) throw new Error(`not in the queue: ${job}`);
  const s = structuredClone(q);
  s.approved ||= {};
  s.approved[job] = [...new Set([...(s.approved[job] || []), ...items])];
  return s;
}

// what the user did not already say yes to at the start
export const fresh = (q, job, items) => items.filter((i) => !(q.approved?.[job] || []).includes(i));

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
// tmp and rename: a killed write leaves the old file, not a torn one
const write = (p, v) => {
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(v, null, 2)}\n`);
  renameSync(tmp, p);
};

if (isMain(import.meta.url)) {
  const [cmd, path, ...rest] = process.argv.slice(2);
  try {
    const load = () => {
      if (!existsSync(path)) throw new Error(`no queue ${path}`);
      return read(path);
    };
    if (cmd === "file") {
      console.log(queueFile(process.cwd()));
    } else if (cmd === "init" && path) {
      write(path, init(rest, existsSync(path) ? read(path) : undefined));
      console.log(JSON.stringify(read(path)));
    } else if (cmd === "next" && path && rest.length === 2) {
      const { queue, step: st } = next(load(), path, rest[0], rest[1]);
      write(path, queue);
      console.log(JSON.stringify(st));
    } else if (cmd === "show" && path) {
      const q = load();
      console.log(JSON.stringify({ ...q, ...step(q, path) }));
    } else if (cmd === "end" && path) {
      write(path, end(load()));
    } else if (cmd === "approve" && path && rest.length >= 2) {
      write(path, approve(load(), rest[0], rest.slice(1)));
    } else if (cmd === "check" && path && rest.length >= 1) {
      console.log(JSON.stringify({ new: fresh(load(), rest[0], rest.slice(1)) }));
    } else {
      console.error("usage: queue.mjs init <qfile> <job...> | next <qfile> <job> <clean|open|stopped> | show <qfile> | end <qfile> | approve <qfile> <job> <item...> | check <qfile> <job> <item...>");
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
