// Tests for queue.mjs: the state of a /ai-kit:continuous queue.
// Usage: node scripts/queue.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approve, end, fresh, init, next, step } from "./queue.mjs";

let failed = 0;
function ok(desc, cond, out) {
  if (!cond) failed++;
  console.log(cond ? `ok   - ${desc}` : `FAIL - ${desc}\n${JSON.stringify(out, null, 2)}`);
}
const throws = (f) => {
  try {
    f();
    return "";
  } catch (e) {
    return e.message;
  }
};
const A = "2026-11-18-aa";
const B = "2026-11-18-bb";
const Q = "/x/claude-review/continuous-queue.json";

const q0 = init([A, B]);
ok("init writes jobs and current 0", q0.current === 0 && q0.jobs.length === 2 && !q0.ended && !Object.keys(q0.outcomes).length, q0);
ok("init refused while the old queue has not ended", /still going.*end/.test(throws(() => init([A], q0))), q0);
ok("init accepted after end", init([A], end(q0)).jobs[0] === A);
ok("bad job id refused", /bad job id/.test(throws(() => init(["nope"]))));

const n1 = next(q0, Q, A, "clean");
ok("next clean gives the second job and its state path", n1.step.action === "job" && n1.step.job === B && n1.step.state === "/x/claude-review/continuous-" + B + ".json", n1);
ok("show names a job with no state file yet", step(n1.queue, Q).state.endsWith(`continuous-${B}.json`));
const again = next(n1.queue, Q, A, "clean");
ok("next twice for the same job moves once", again.queue.current === 1 && again.step.job === B, again);
const n2 = next(n1.queue, Q, B, "clean");
ok("next clean again ends with both in ran", n2.step.action === "end" && n2.step.ran.length === 2 && !n2.step.notRun.length && n2.queue.ended, n2);
for (const o of ["open", "stopped"]) {
  const r = next(q0, Q, A, o);
  ok(`next ${o} on the first job ends with the second in notRun`, r.step.action === "end" && r.step.ran[0] === A && r.step.notRun[0] === B && r.queue.ended, r);
}
ok("bad outcome refused", /outcome/.test(throws(() => next(q0, Q, A, "fine"))));

const ap = approve(q0, B, ["heldBy:b2", "running"]);
ok("a heldBy approved at the start is not new for the later job", !fresh(ap, B, ["heldBy:b2"]).length, ap);
ok("what was not approved is new", fresh(ap, B, ["heldBy:b2", "heldBy:b3", "dirty"]).join() === "heldBy:b3,dirty");
// a yes to the tree the user saw: a path dirtied after the start is new
const apd = approve(q0, B, ["dirty:src/a.ts", "loose:abc1234"]);
ok("an approved dirty path and loose hash are not new", !fresh(apd, B, ["dirty:src/a.ts", "loose:abc1234"]).length, apd);
ok("a path dirtied later is new", fresh(apd, B, ["dirty:src/a.ts", "dirty:src/b.ts"]).join() === "dirty:src/b.ts");

// CLI: a git repo's review dir holds the queue file
const dir = mkdtempSync(join(tmpdir(), "queue-"));
const run = (...a) => spawnSync("node", [new URL("./queue.mjs", import.meta.url).pathname, ...a], { encoding: "utf8" });
const qf = join(dir, "continuous-queue.json");
const r1 = run("init", qf, A, B);
const r2 = run("init", qf, A);
ok("cli init then a second init refused", r1.status === 0 && r2.status === 1 && /queue.mjs end/.test(r2.stderr), [r1, r2]);
const r3 = run("show", qf);
ok("cli show names the current job and state", JSON.parse(r3.stdout).job === A && JSON.parse(r3.stdout).state === join(dir, `continuous-${A}.json`), r3.stdout);
run("next", qf, A, "clean");
const r4 = run("next", qf, B, "open");
ok("cli next ends on open", JSON.parse(r4.stdout).action === "end", r4);
const qa = join(dir, "approved-queue.json");
run("init", qa, A, B);
const ra = run("approve", qa, B, "heldBy:b2", "running");
const rc = run("check", qa, B, "heldBy:b2", "running");
ok("cli init, approve, then check prints an empty new", ra.status === 0 && rc.status === 0 && !JSON.parse(rc.stdout).new.length, [ra, rc]);
ok("cli end and re-init", run("end", qf).status === 0 && run("init", qf, A).status === 0);
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
