// Lists jobs (the `Job:` commit trailer, one per user request) and, for one job, what reverting it involves.
//   node scripts/jobs.mjs              recent jobs: id, commits, dates, first subject
//   node scripts/jobs.mjs <id|text>    that job's commits, files, migrations, later commits on the same files, revert
// Run inside the project; ai/kit/config.json `jobs.migrations` (regex on the path) names its migration files.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const config = join(root, "ai", "kit", "config.json");
let MIGRATION = null;
try {
  const re = existsSync(config) && JSON.parse(readFileSync(config, "utf8"))?.jobs?.migrations;
  if (typeof re === "string" && re) MIGRATION = new RegExp(re);
} catch (e) {
  console.log(`! ai/kit/config.json jobs.migrations ignored: ${e.message}`);
}
const LIST_MAX = 40;
const LATER_MAX = 30;
const ids = (s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const log = git(
  "log",
  "--date=short",
  "--format=%H%x1f%P%x1f%ad%x1f%s%x1f%(trailers:key=Job,valueonly,separator=%x2C)%x1f%(trailers:key=Reverts-Job,valueonly,separator=%x2C)%x1f%b%x1e",
)
  .split("\x1e")
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [hash, parents, date, subject, job, reverts, body] = r.split("\x1f");
    const revertsHashes = [
      ...body.matchAll(/This reverts commit ([0-9a-f]{40})/g),
    ].map((m) => m[1]);
    return {
      hash,
      merge: parents.trim().split(" ").length > 1,
      date,
      subject,
      jobs: ids(job),
      reverts: ids(reverts),
      revertsHashes,
    };
  });

// a revert names its targets by hash (plain `git revert`) or by job (`Reverts-Job:`); walked oldest first, so
// reverting a revert makes its targets live again
const targetsOf = (c) => [
  ...c.revertsHashes,
  ...(c.reverts.length
    ? log
        .filter(
          (x) => x.hash !== c.hash && x.jobs.some((j) => c.reverts.includes(j)),
        )
        .map((x) => x.hash)
    : []),
];
const byHash = new Map(log.map((c) => [c.hash, c]));
const reverted = new Set();
for (const c of [...log].reverse())
  for (const t of targetsOf(c)) {
    reverted.add(t);
    const r = byHash.get(t);
    if (r) for (const x of targetsOf(r)) reverted.delete(x);
  }
const revertFlag = (cs) => {
  const n = cs.filter((c) => reverted.has(c.hash)).length;
  return n === 0
    ? ""
    : n === cs.length
      ? "  [reverted]"
      : `  [partly reverted: ${n} of ${cs.length}]`;
};

const arg = process.argv[2];

if (!arg) {
  const jobs = new Map();
  for (const c of log)
    for (const id of c.jobs) {
      const j = jobs.get(id) ?? { commits: [] };
      j.commits.push(c);
      jobs.set(id, j);
    }
  if (jobs.size === 0)
    console.log(
      "No commit carries a Job: trailer yet (rule: the ai-kit plugin's docs/shared-checkout.md §Jobs).",
    );
  for (const [id, j] of [...jobs].slice(0, LIST_MAX)) {
    const first = j.commits.at(-1);
    const dates =
      first.date === j.commits[0].date
        ? first.date
        : `${first.date}..${j.commits[0].date}`;
    const flag = revertFlag(j.commits);
    console.log(
      `${id}  ${j.commits.length} commit(s)  ${dates}  ${first.subject}${flag}`,
    );
  }
  if (jobs.size > LIST_MAX)
    console.log(`... and ${jobs.size - LIST_MAX} older job(s)`);
  process.exit(0);
}

let id = log.some((c) => c.jobs.includes(arg)) ? arg : null;
if (!id) {
  const found = [
    ...new Set(log.flatMap((c) => c.jobs.filter((j) => j.includes(arg)))),
  ];
  if (found.length !== 1) {
    console.log(
      found.length
        ? `"${arg}" matches several jobs:\n  ${found.join("\n  ")}`
        : `No job matches "${arg}".`,
    );
    process.exit(1);
  }
  id = found[0];
}

const commits = log.filter((c) => c.jobs.includes(id));
const hashes = new Set(commits.map((c) => c.hash));
const files = new Set();
const migrations = new Set();
// oldest first, renames as delete + add, so a migration re-stamped inside the job ends under its last name
for (const c of [...commits].reverse()) {
  for (const line of git(
    "show",
    "--no-renames",
    "--name-status",
    "--format=",
    c.hash,
    "--",
    ".",
    ":(exclude)ai/usage",
  ).split("\n")) {
    const [status, path] = line.split("\t");
    if (!path) continue;
    files.add(path);
    if (!MIGRATION?.test(path)) continue;
    const name = basename(path).replace(/\.[^.]+$/, "");
    if (status === "A") migrations.add(name);
    if (status === "D") migrations.delete(name);
  }
}

console.log(`Job ${id}: ${commits.length} commit(s), newest first`);
for (const c of commits)
  console.log(
    `  ${c.hash.slice(0, 9)}  ${c.date}  ${c.subject}${c.merge ? "  [merge]" : ""}${reverted.has(c.hash) ? "  [reverted]" : ""}`,
  );
const revertedBy = log.filter(
  (c) => c.reverts.includes(id) || c.revertsHashes.some((h) => hashes.has(h)),
);
if (revertedBy.length)
  console.log(
    `\nReverted by: ${revertedBy.map((c) => c.hash.slice(0, 9)).join(", ")}`,
  );

console.log(`\nFiles (${files.size}):`);
for (const f of [...files].sort()) console.log(`  ${f}`);

if (migrations.size) {
  console.log(
    "\nMigrations added (a code revert does not undo them in a database that applied them):",
  );
  for (const m of migrations) console.log(`  ${m}`);
}

const oldest = commits.at(-1).hash;
// literal pathspecs: a route folder like [id] is otherwise a glob character class
const later = git(
  "--literal-pathspecs",
  "log",
  "--format=%H%x1f%s",
  `${oldest}..HEAD`,
  "--",
  ...files,
)
  .split("\n")
  .filter(Boolean)
  .map((l) => l.split("\x1f"))
  .filter(([h]) => !hashes.has(h) && !revertedBy.some((r) => r.hash === h));
if (later.length) {
  console.log(
    `\nLater commits of other jobs touch these files (a revert may conflict with them):`,
  );
  for (const [h, s] of later.slice(0, LATER_MAX))
    console.log(`  ${h.slice(0, 9)}  ${s}`);
  if (later.length > LATER_MAX)
    console.log(`  ... and ${later.length - LATER_MAX} more`);
}

const live = commits.filter((c) => !reverted.has(c.hash));
if (!live.length) {
  console.log("\nAlready reverted: no revert command printed.");
  process.exit(0);
}
console.log(
  `\nRevert as one commit (newest first${live.length < commits.length ? ", the commits not yet reverted" : ""}):`,
);
if (live.some((c) => c.merge))
  console.log(
    "  a [merge] commit needs its own `git revert -m 1 --no-commit <hash>`",
  );
const plain = live.filter((c) => !c.merge);
if (plain.length)
  console.log(
    `  git revert --no-commit ${plain.map((c) => c.hash.slice(0, 9)).join(" ")}`,
  );
console.log(
  `  git commit   # subject "revert: ...", trailers "Job: <new id>" and "Reverts-Job: ${id}"`,
);
