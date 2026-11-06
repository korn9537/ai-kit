#!/usr/bin/env node
// The plan file: batches in ai/plans/<job>.md, status from the job's commits, so a lost session loses no batch.
// Usage: plan.mjs write <args.json> [--replace] | status [job] [--quick] | resume [job] | close <job> [--drop]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readRepo } from "./continuous.mjs";

const JOB = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
const relPath = (job) => `ai/plans/${job}.md`;
// what a repo's doc check allows
const COLUMNS = 120;
const width = (s) => JSON.stringify(s).length - 2;
const wrapped = (v) => Array.isArray(v?.lines) && Object.keys(v).length === 1;

// cut at whitespace, inside a word only when it alone is too wide (Thai has no spaces); joined, it is the text again
function chunks(text, max) {
  const out = [""];
  for (const word of text.split(/(?<=\s)/)) {
    for (const piece of width(word) > max ? [...word] : [word]) {
      if (width(out.at(-1) + piece) > max) out.push("");
      out[out.length - 1] += piece;
    }
  }
  return out;
}

// a string that passes COLUMNS where JSON.stringify would put it, as { lines }: lead is its quoted key and ": ", 3 is
// its own quotes and comma, 4 the indent of the items
function fold(v, indent = 0, lead = 0) {
  if (typeof v === "string") {
    return indent + lead + width(v) + 3 > COLUMNS ? { lines: chunks(v, COLUMNS - indent - 4 - 3) } : v;
  }
  if (Array.isArray(v)) return v.map((x) => fold(x, indent + 2));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fold(x, indent + 2, width(k) + 4)]));
  }
  return v;
}

// every word a person wrote stays in the fence: check-docs reads ai/*.md strictly (Thai, dates, bold) outside one;
// a JSON string cannot wrap, so a long one is written as { lines } and parse joins it
export function render(plan) {
  const title = plan.job.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const { job, request, batches } = plan;
  return [
    `# Plan ${title}`,
    "",
    "goal: the request in the block below, one commit per batch.",
    `job: \`${job}\``,
    "status: the commits of this job, by their Batch trailer (`plan.mjs status`); never edited here.",
    "",
    "```json",
    JSON.stringify(fold({ job, request, batches }), null, 2),
    "```",
    "",
  ].join("\n");
}

// null for a plan written by hand: it has no job and no batches to run
export function parse(text) {
  const m = /^```json\r?\n([\s\S]*?)\r?\n```\r?$/m.exec(text);
  if (!m) return null;
  try {
    const plan = JSON.parse(m[1], (_, v) => (wrapped(v) ? v.lines.join("") : v));
    const fine = JOB.test(plan?.job ?? "") && Array.isArray(plan.batches) && plan.batches.every(
      (b) => typeof b?.id === "string" && (b.waitsFor === undefined || Array.isArray(b.waitsFor)),
    );
    return fine ? plan : null;
  } catch {
    return null;
  }
}

// plan order with each batch after what it waits for, otherwise as given: run-plan.js skips a batch whose waitsFor
// has not run yet, and a batch added to an old plan comes last in the file
export function ordered(batches) {
  const byId = new Map(batches.map((b) => [b.id, b]));
  const out = [];
  const state = new Map();
  const visit = (b) => {
    if (state.get(b.id) === "done") return;
    if (state.get(b.id) === "open") throw new Error(`waitsFor goes in a circle at ${b.id}`);
    state.set(b.id, "open");
    for (const w of b.waitsFor || []) if (byId.has(w)) visit(byId.get(w));
    state.set(b.id, "done");
    out.push(b);
  };
  batches.forEach(visit);
  return out;
}

// args are what the workflow will run, so a mistake here would surface as a skipped batch long after the start;
// replace: old batches with no commit that the args leave out are gone, for a plan fixed after a refusal
export function merge(old, args, commits = new Map(), replace = false) {
  if (!JOB.test(args.job || "")) throw new Error(`job is not <yyyy-mm-dd>-<slug>: ${args.job}`);
  if (!args.batches?.length) throw new Error("args need batches");
  const seen = new Set();
  for (const b of args.batches) {
    if (!b.id || /\s/.test(b.id)) throw new Error(`batch id is empty or holds a space: ${b.id}`);
    if (!b.title || !b.brief) throw new Error(`batch ${b.id} needs a title and a brief`);
    if (seen.has(b.id)) throw new Error(`batch id appears twice: ${b.id}`);
    if (commits.has(b.id)) throw new Error(`batch ${b.id} already has commit ${commits.get(b.id)}, pick a new id`);
    for (const w of b.waitsFor || []) {
      if (seen.has(w)) continue;
      if (args.batches.some((x) => x.id === w)) throw new Error(`${b.id} waits for ${w}, planned after it`);
      if (commits.has(w)) throw new Error(`${b.id} waits for ${w}, committed: drop it from waitsFor once its review is clean`);
      // run-plan.js counts an id outside the run as not committed and would skip this batch
      throw new Error(`${b.id} waits for ${w}, not in this run`);
    }
    seen.add(b.id);
  }
  const given = new Map(args.batches.map((b) => [b.id, b]));
  const kept = (old?.batches || [])
    .filter((b) => !replace || given.has(b.id) || commits.has(b.id))
    .map((b) => given.get(b.id) ?? b);
  const known = new Set((old?.batches || []).map((b) => b.id));
  const batches = ordered([...kept, ...args.batches.filter((b) => !known.has(b.id))]);
  const ids = new Set(batches.map((b) => b.id));
  for (const b of batches) {
    for (const w of b.waitsFor || []) {
      if (!ids.has(w) && !commits.has(w)) throw new Error(`${b.id} waits for ${w}, not in the plan`);
    }
  }
  return { job: args.job, request: args.request || old?.request || "", batches };
}

// left: batches with no commit of their own; ready: those of them no other left batch holds back
export function progress(plan, commits) {
  const left = plan.batches.filter((b) => !commits.has(b.id));
  const open = new Set(left.map((b) => b.id));
  return {
    done: plan.batches.filter((b) => commits.has(b.id)).map((b) => ({ id: b.id, hash: commits.get(b.id) })),
    left: left.map((b) => b.id),
    ready: left.filter((b) => !(b.waitsFor || []).some((w) => open.has(w))).map((b) => b.id),
  };
}

// run-plan.js counts a waitsFor id outside the run as not committed, so a committed one leaves the list
export function resumeArgs(plan, commits, plugin) {
  const batches = plan.batches
    .filter((b) => !commits.has(b.id))
    .map((b) => ({ ...b, waitsFor: (b.waitsFor || []).filter((w) => !commits.has(w)) }));
  return { request: plan.request, plugin, job: plan.job, batches };
}

export function statusLine(plan, commits) {
  const p = progress(plan, commits);
  const head = `${plan.job}: ${p.done.length} of ${plan.batches.length} batches committed`;
  if (!p.left.length) return `${head}, none left`;
  const held = p.left.filter((id) => !p.ready.includes(id));
  return `${head}; ready ${p.ready.join(", ")}${held.length ? `; waiting ${held.join(", ")}` : ""}`;
}

const planFiles = (root) => {
  try {
    return readdirSync(join(root, "ai", "plans"))
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => join(root, "ai", "plans", f));
  } catch {
    return [];
  }
};

// a log that failed is not a plan with no commits: that would offer every batch again
function commitsOf(root, job) {
  const repo = readRepo(root, job);
  if (repo.logFailed) throw new Error(`git log failed, the status of ${job} is not known`);
  return repo.commits;
}

// a done row with no todo or doing row left; a table of another shape counts as nothing
const handFinished = (text) =>
  /\|\s*done\s*\|/.test(text) && !/\|\s*(todo|doing)\s*\|/.test(text);

// what kit.mjs check warns about: a plan whose work is over is still in the tree; never throws, check runs in pre-commit
export function planWarnings(root) {
  return planFiles(root).flatMap((path) => {
    try {
      const text = readFileSync(path, "utf8");
      const rel = path.slice(root.length + 1);
      const plan = parse(text);
      if (!plan) {
        return handFinished(text)
          ? [`${rel} has no task left (fix: move any open question to where it belongs, then delete the plan in a commit)`]
          : [];
      }
      if (progress(plan, commitsOf(root, plan.job)).left.length) return [];
      return [`${rel} has every batch committed (fix: read the job's report for what is still open, then node <plugin>/scripts/plan.mjs close ${plan.job})`];
    } catch {
      return [];
    }
  });
}

const gitIn = (root) => (...a) =>
  execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// no paths on the commit (a path-limited one leaves the pre-commit's records behind), so anything else staged would
// ride along: refused instead. The Plan-File trailer keeps it out of continuous.mjs's commits with no batch
function commit(root, job, subject, kind, stage, undo) {
  const git = gitIn(root);
  const others = git("diff", "--cached", "--name-only", "--", ".", ":(exclude)ai/usage", `:(exclude)${relPath(job)}`).trim();
  if (others) throw new Error(`the index holds other files, commit them first:\n${others}`);
  try {
    stage();
    git("commit", "-q", "-m", `${subject}\n\nPlan-File: ${kind}\nJob: ${job}`);
  } catch (e) {
    undo();
    // another session holding index.lock must not cost the file above or hide this error
    try {
      git("reset", "-q", "--", relPath(job));
    } catch {}
    throw new Error(`the commit failed: ${(e.stdout || "") + (e.stderr || "") || e.message}`);
  }
}

// HEAD, not the index: a plan staged by a killed run is not committed yet
const committed = (root, rel) => {
  try {
    // ./ reads from the project root, which may sit below the top of the repo
    gitIn(root)("cat-file", "-e", `HEAD:./${rel}`);
    return true;
  } catch {
    return false;
  }
};

// status skips a plan that does not parse, and a doc check refuses the commit of one too wide: neither shows at the start
function refuseFile(text, plan, isNew) {
  const back = parse(text);
  if (!back) throw new Error("the plan would not parse back: an id that is not a string, or a waitsFor that is not a list");
  if (JSON.stringify(back) !== JSON.stringify(plan)) throw new Error("a field shaped { lines } would come back as a string");
  const over = text.split("\n").find((l) => l.length > COLUMNS);
  // a job id cannot be renamed once commits carry it, so a plan already in the repo stays writable
  if (over && isNew) throw new Error(`a plan line passes ${COLUMNS} columns, shorten its job, key or nesting: ${over.slice(0, 60)}`);
}

export function write(root, args, replace = false) {
  const rel = relPath(args.job);
  const path = join(root, rel);
  const before = existsSync(path) ? readFileSync(path, "utf8") : null;
  const old = before === null ? null : parse(before);
  if (before !== null && !old) throw new Error(`${rel} is not a plan this script wrote`);
  const plan = merge(old, args, commitsOf(root, args.job), replace);
  const text = render(plan);
  refuseFile(text, plan, !old);
  // parsed, not as text: a formatter in the pre-commit rewrites the block
  if (old && JSON.stringify(old) === JSON.stringify(parse(text)) && committed(root, rel)) return { plan: rel, committed: false };
  // a failed commit leaves no plan behind, and the run must not start as if it had one
  commit(root, args.job, `docs: plan ${args.job}`, "write", () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    gitIn(root)("add", "--", rel);
  }, () => {
    if (before === null) rmSync(path, { force: true });
    else writeFileSync(path, before);
  });
  return { plan: rel, committed: true };
}

export function close(root, job, drop = false) {
  const rel = relPath(job);
  const path = join(root, rel);
  if (!existsSync(path)) throw new Error(`no plan ${rel}`);
  const before = readFileSync(path);
  const plan = parse(before.toString("utf8"));
  if (!plan) throw new Error(`${rel} is not a plan this script wrote`);
  const { left } = progress(plan, commitsOf(root, job));
  if (left.length && !drop) throw new Error(`batches left: ${left.join(", ")}; --drop gives them up`);
  if (!committed(root, rel)) {
    // staged by a killed run, it would ride along with the next commit
    gitIn(root)("rm", "-q", "--cached", "--ignore-unmatch", "--", rel);
    rmSync(path);
    return { plan: rel, dropped: left };
  }
  commit(root, job, `docs: close plan ${job}`, "close", () => gitIn(root)("rm", "-q", "-f", "--", rel), () => {
    // git rm took the folder too when this was its last file
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, before);
  });
  return { plan: rel, dropped: left };
}

const openPlans = (root) =>
  planFiles(root)
    .map((path) => parse(readFileSync(path, "utf8")))
    .filter(Boolean);

function pickPlan(root, job) {
  const plans = openPlans(root);
  if (job) {
    const plan = plans.find((p) => p.job === job);
    if (!plan) throw new Error(`no plan of job ${job}`);
    return plan;
  }
  const left = plans.filter((p) => progress(p, commitsOf(root, p.job)).left.length);
  if (left.length === 1 || (!left.length && plans.length === 1)) return left[0] ?? plans[0];
  throw new Error(`name one job: ${(left.length ? left : plans).map((p) => p.job).join(", ") || "no plan here"}`);
}

const reviewDir = (root) => join(gitIn(root)("rev-parse", "--absolute-git-dir").trim(), "claude-review");

// the state of a /ai-kit:continuous run of this job, the one record of how a batch ended that outlives its session
function continuousState(root, job) {
  const path = join(reviewDir(root), `continuous-${job}.json`);
  try {
    return { path, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return null;
  }
}

export function resume(root, job, plugin) {
  const plan = pickPlan(root, job);
  const commits = commitsOf(root, plan.job);
  const repo = readRepo(root, plan.job);
  const p = progress(plan, commits);
  const run = continuousState(root, plan.job);
  // a commit does not say its batch ended clean, and run-plan.js holds back what waits on a partial one: the args
  // below drop that wait, so what waits on a commit of unknown end is named for §Resume to clear first
  const unknown = (id) => commits.has(id) && run?.batches?.[id]?.status !== "committed";
  const heldBy = Object.fromEntries(
    plan.batches
      .filter((b) => !commits.has(b.id) && (b.waitsFor || []).some(unknown))
      .map((b) => [b.id, b.waitsFor.filter(unknown)]),
  );
  const out = {
    job: plan.job, committed: p.done, left: p.left, ready: p.ready.filter((id) => !heldBy[id]), heldBy,
    loose: repo.loose, dirty: repo.dirty,
    continuousRunning: !!(run?.running || run?.launching),
    ...(run ? { continuousState: run.path } : {}),
  };
  if (!p.left.length) return out;
  const dir = reviewDir(root);
  mkdirSync(dir, { recursive: true });
  const argsFile = join(dir, `plan-${plan.job}.args.json`);
  writeFileSync(argsFile, `${JSON.stringify(resumeArgs(plan, commits, plugin), null, 2)}\n`);
  return { ...out, argsFile };
}

// budget in ms for all plans: the session-start hook shares a 10 s limit, and a kill there loses the whole injection
export function status(root, job, budget = 0) {
  const end = budget ? Date.now() + budget : 0;
  return openPlans(root)
    .filter((p) => !job || p.job === job)
    .map((p) => {
      const timeout = end ? end - Date.now() : undefined;
      const repo = timeout === undefined || timeout > 0 ? readRepo(root, p.job, { timeout, dirty: false }) : { logFailed: true };
      return repo.logFailed ? `${p.job}: status not known` : statusLine(p, repo.commits);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith("--"));
  const [cmd, arg] = argv.filter((a) => !a.startsWith("--"));
  const plugin = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    if (cmd === "write" && arg) {
      const args = JSON.parse(readFileSync(arg, "utf8"));
      console.log(JSON.stringify(write(args.repo || process.cwd(), args, flags.includes("--replace"))));
    } else if (cmd === "status") {
      status(process.cwd(), arg, flags.includes("--quick") ? 2000 : 0).forEach((l) => console.log(l));
    } else if (cmd === "resume") {
      console.log(JSON.stringify(resume(process.cwd(), arg, plugin)));
    } else if (cmd === "close" && arg) {
      console.log(JSON.stringify(close(process.cwd(), arg, flags.includes("--drop"))));
    } else {
      console.error("usage: plan.mjs write <args.json> [--replace] | status [job] [--quick] | resume [job] | close <job> [--drop]");
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
