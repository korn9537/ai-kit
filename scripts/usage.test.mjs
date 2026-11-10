// Tests for usage.mjs: the buffer lock, flush idempotence under parallel processes and parallel records.
// Usage: node scripts/usage.test.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { LOCK_STALE_MS, breakLock, flushIdle, seedBuffer, withLock } from "./usage.mjs";
import { loadRecords } from "./lib/usage-digest.mjs";

let passed = 0;
let failed = 0;
function eq(desc, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    passed++;
    console.log(`ok   - ${desc}`);
  } else {
    failed++;
    console.log(`FAIL - ${desc}\n  got:  ${g}\n  want: ${w}`);
  }
}
const run = (cmd, args, opts) => new Promise((res) => {
  const c = spawn(cmd, args, { ...opts, stdio: ["pipe", "ignore", "ignore"] });
  c.stdin.end(opts.input ?? "");
  c.on("close", res);
});

const tmp = mkdtempSync(join(tmpdir(), "usage-flush-"));
try {
  const repo = join(tmp, "repo");
  mkdirSync(join(repo, "ai", "kit"), { recursive: true });
  writeFileSync(join(repo, "ai", "kit", "config.json"), "{}");
  const g = (...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  g("init", "-q");
  g("config", "user.name", "t");
  g("config", "user.email", "t@t");
  g("add", "-A");
  g("commit", "-qm", "base");
  const bufDir = join(repo, ".git", "claude-usage");
  mkdirSync(bufDir, { recursive: true });
  const rec = (session, i) => JSON.stringify({ v: 1, ts: `2030-01-15T10:00:0${i}Z`, session, round: i, agents: [{ model: "m", read: 10 }] });
  for (let s = 0; s < 8; s++) {
    const name = `sess${s}`;
    writeFileSync(join(bufDir, `${name}.jsonl`), `${rec(name, 1)}\n${rec(name, 2)}\n`);
    const t = Date.now() / 1000 - 25200;
    utimesSync(join(bufDir, `${name}.jsonl`), t, t);
  }
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo };
  const cli = join(import.meta.dirname, "usage.mjs");
  await Promise.all([1, 2, 3, 4].map(() => run("node", [cli, "flush", "--idle"], { env })));
  const usage = join(repo, "ai", "usage");
  const files = readdirSync(usage, { recursive: true }).filter((f) => String(f).endsWith(".jsonl"));
  eq("four parallel idle flushes write one file per buffer", files.length, 8);
  eq("and every record is counted once", loadRecords(usage).recs.length, 16);
  eq("the lock is released", existsSync(join(bufDir, ".lock")), false);

  // a crash between the file and the sidecar leaves a second file with the same lines: counted once
  const month = String(files[0]).split(/[/\\]/)[0];
  const first = readFileSync(join(usage, String(files[0])), "utf8");
  writeFileSync(join(usage, month, "dup.2.jsonl"), first);
  eq("the same (session, ts) in two files counts once", loadRecords(usage).recs.length, 16);

  // a stale lock expires, a fresh one blocks until released
  const lock = join(bufDir, ".lock");
  const brk = `${lock}.break`;
  const host = hostname().replace(/:/g, "_");
  const old = (Date.now() - LOCK_STALE_MS - 5000) / 1000;
  const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore" });
  // a live PID with an old mtime: the age rule runs, not the dead-PID rule
  writeFileSync(lock, `${holder.pid}:${host}:tok`);
  utimesSync(lock, old, old);
  eq("a stale lock held by a live PID does not block", withLock(bufDir, () => "ran"), "ran");
  eq("and .lock.break is gone", existsSync(brk), false);

  // an old empty lock is broken (a fresh empty one is live, tested below)
  writeFileSync(lock, "");
  eq("an old empty lock is broken", (utimesSync(lock, old, old), withLock(bufDir, () => "ran", { waitMs: 0 })), "ran");

  // an old-format lock (`<pid>`, no host) of a live process clears by the age rule
  writeFileSync(lock, String(holder.pid));
  utimesSync(lock, old, old);
  eq("an old-format lock clears by the age rule", [withLock(bufDir, () => "ran", { waitMs: 500 }), existsSync(lock)], ["ran", false]);

  // a lock that cannot be unlinked (a directory reads as null, unlink says EISDIR/EPERM) is not reported as broken
  mkdirSync(lock);
  eq("breakLock returns false when the unlink fails", [breakLock(lock, null), existsSync(lock)], [false, true]);
  eq("and .lock.break is removed", existsSync(brk), false);
  rmSync(lock, { recursive: true });

  // `seen` no longer matches the file under .lock.break: the lock stays
  writeFileSync(lock, `${holder.pid}:${host}:new`);
  utimesSync(lock, old, old);
  eq("a lock that changed since it was seen is not removed", [breakLock(lock, "other"), readFileSync(lock, "utf8")], [false, `${holder.pid}:${host}:new`]);
  eq("and .lock.break is removed", existsSync(brk), false);
  rmSync(lock);

  // a .lock.break left by a killed process expires by age; a fresh one defers breaking
  writeFileSync(lock, `${holder.pid}:${host}:old`);
  utimesSync(lock, old, old);
  writeFileSync(brk, "1");
  let code = "";
  try {
    withLock(bufDir, () => "ran", { waitMs: 100 });
  } catch (e) {
    code = e.code;
  }
  eq("a fresh .lock.break defers breaking", [code, existsSync(lock)], ["ELOCKED", true]);
  utimesSync(brk, old, old);
  eq("an expired .lock.break is cleared and the stale lock then broken", withLock(bufDir, () => "ran", { waitMs: 2000 }), "ran");
  eq("leaving neither file", [existsSync(lock), existsSync(brk)], [false, false]);

  // an unreadable .lock reaches ELOCKED instead of spinning
  mkdirSync(lock);
  let t0 = Date.now();
  code = "";
  try {
    withLock(bufDir, () => "ran", { waitMs: 200 });
  } catch (e) {
    code = e.code;
  }
  eq("an unreadable .lock times out with ELOCKED", [code, Date.now() - t0 >= 180], ["ELOCKED", true]);
  rmSync(lock, { recursive: true });

  // a live holder blocks until the deadline, then withLock throws ELOCKED; its lock file is left alone
  writeFileSync(lock, `${holder.pid}:${host}:tok`);
  t0 = Date.now();
  code = "";
  try {
    withLock(bufDir, () => "ran", { waitMs: 300 });
  } catch (e) {
    code = e.code;
  }
  eq("a live lock blocks, then times out with ELOCKED", [code, Date.now() - t0 >= 280], ["ELOCKED", true]);
  eq("and stays in place", readFileSync(lock, "utf8"), `${holder.pid}:${host}:tok`);
  t0 = Date.now();
  try {
    withLock(bufDir, () => "ran", { waitMs: 0 });
  } catch {}
  eq("waitMs 0 tries once and returns at once", Date.now() - t0 < 1000, true);
  rmSync(lock);
  writeFileSync(lock, "");
  code = "";
  try {
    withLock(bufDir, () => "ran", { waitMs: 100 });
  } catch (e) {
    code = e.code;
  }
  eq("an empty lock file counts as live", code, "ELOCKED");
  // a lock held by a dead PID is broken at once
  holder.kill();
  await new Promise((r) => holder.on("close", r));
  writeFileSync(lock, `${holder.pid}:${host}:tok`);
  t0 = Date.now();
  eq("a dead PID's lock is broken at once", [withLock(bufDir, () => "ran", { waitMs: 5000 }), Date.now() - t0 < 1000], ["ran", true]);
  eq("and released", existsSync(lock), false);
  // release removes only the lock that holds our own token
  withLock(bufDir, () => writeFileSync(lock, `${process.pid}:${host}:other`));
  eq("a lock taken over by another holder is not released by us", readFileSync(lock, "utf8"), `${process.pid}:${host}:other`);
  rmSync(lock);

  // idle flush with a held lock skips without waiting
  const idleBuf = join(bufDir, "idle1.jsonl");
  writeFileSync(idleBuf, `${rec("idle1", 1)}\n`);
  const tOld = Date.now() / 1000 - 25200;
  utimesSync(idleBuf, tOld, tOld);
  writeFileSync(lock, `${process.pid}:${host}:held`);
  t0 = Date.now();
  eq("idle flush with a held lock writes nothing", flushIdle(repo, bufDir), []);
  eq("and does not wait", Date.now() - t0 < 1000, true);
  rmSync(lock);
  eq("idle flush then writes it", flushIdle(repo, bufDir).length, 1);
  t0 = Date.now();
  writeFileSync(lock, `${process.pid}:${host}:held`);
  eq("idle flush skips a flushed buffer without taking the lock", flushIdle(repo, bufDir), []);
  rmSync(lock);

  // seeding from duplicate files keeps each line once and counts the deduped lines as flushed
  const seedRoot = join(tmp, "seedroot");
  const seedBufDir = join(tmp, "seedbuf");
  mkdirSync(join(seedRoot, "ai", "usage", "2030-01"), { recursive: true });
  const two = `${rec("sd", 1)}\n${rec("sd", 2)}\n`;
  writeFileSync(join(seedRoot, "ai", "usage", "2030-01", "sd.jsonl"), two);
  writeFileSync(join(seedRoot, "ai", "usage", "2030-01", "sd.2.jsonl"), two);
  seedBuffer(seedRoot, seedBufDir, "sd");
  eq("seed dedupes lines", readFileSync(join(seedBufDir, "sd.jsonl"), "utf8"), two);
  eq("and flags the deduped count", readFileSync(join(seedBufDir, "sd.flushed"), "utf8"), "2 2");

  // parallel records: three Stop hooks at once must sum to the transcript
  const transcript = join(tmp, "t.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ type: "user", timestamp: "2030-01-15T10:00:00Z", message: { role: "user", content: "ask" } })}\n`
    + `${JSON.stringify({ type: "assistant", timestamp: "2030-01-15T10:00:30Z", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1000, output_tokens: 1 } } })}\n`);
  const input = JSON.stringify({ session_id: "par", transcript_path: transcript, cwd: repo });
  await Promise.all([1, 2, 3].map(() => run("node", [cli, "record"], { env, input })));
  const lines = readFileSync(join(bufDir, "par.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  eq("three parallel records sum to the true input", lines.reduce((n, r) => n + r.agents.reduce((m, a) => m + (a.input ?? 0), 0), 0), 1000);

  // refusals: a hook's record lands in a subfolder buffer, flushes to a new ai/usage/refusals/** file only
  const rrepo = join(tmp, "rrepo");
  mkdirSync(join(rrepo, "ai", "kit"), { recursive: true });
  writeFileSync(join(rrepo, "ai", "kit", "config.json"), "{}");
  const rg = (...a) => spawnSync("git", ["-C", rrepo, ...a], { encoding: "utf8" });
  rg("init", "-q");
  rg("config", "user.name", "t");
  rg("config", "user.email", "t@t");
  rg("add", "-A");
  rg("commit", "-qm", "base");
  const rbuf = join(rrepo, ".git", "claude-usage");
  const renv = { ...process.env, CLAUDE_PROJECT_DIR: rrepo };
  const refuse = (rule, cwd = rrepo) => spawnSync("node", [cli, "refusal", rule], { cwd, env: renv, encoding: "utf8" });
  const rbufFile = join(rbuf, "refusals", "buffer.log");
  eq("refusal exits 0", refuse("pre-commit.comments").status, 0);
  const brec = readFileSync(rbufFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  eq("one record in the buffer", brec.length, 1);
  eq("record fields", [brec[0].v, brec[0].rule, typeof brec[0].ts, typeof brec[0].kit, typeof brec[0].branch], [1, "pre-commit.comments", "string", "string", "string"]);
  eq("the lock is released after a refusal", existsSync(join(rbuf, ".lock")), false);
  eq("a bad rule id writes nothing", [refuse("bad id!").status, readFileSync(rbufFile, "utf8").split("\n").filter(Boolean).length], [0, 1]);
  // an old buffer in the subfolder is left alone by the idle flush of session buffers, and nothing lands in ai/usage/<month>
  const old6 = Date.now() / 1000 - 25200;
  utimesSync(rbufFile, old6, old6);
  eq("idle flush leaves the refusal buffer", [flushIdle(rrepo, rbuf), existsSync(rbufFile), existsSync(join(rrepo, "ai", "usage"))], [[], true, false]);
  // a lock held by a live process: the refusal gives up within the wait and writes nothing
  const lockHolder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore" });
  writeFileSync(join(rbuf, ".lock"), `${lockHolder.pid}:${hostname().replace(/:/g, "_")}:tok`);
  const rt0 = Date.now();
  const held = refuse("commit-msg.job");
  eq("a held lock: skipped with a stderr line, no record", [held.status, /kit-log/.test(held.stderr), readFileSync(rbufFile, "utf8").split("\n").filter(Boolean).length], [0, true, 1]);
  eq("and it gave up within the 1.5 s budget (plus node start)", Date.now() - rt0 < 2200, true);
  lockHolder.kill();
  rmSync(join(rbuf, ".lock"), { force: true });
  refuse("commit-msg.job");
  spawnSync("node", [cli, "flush", "--idle"], { env: renv });
  const rfiles = readdirSync(join(rrepo, "ai", "usage"), { recursive: true }).map(String).filter((f) => f.endsWith(".jsonl"));
  eq("flush writes the refusals to new files under ai/usage/refusals/ only", [rfiles.length, rfiles.every((f) => /^refusals[/\\]\d{4}-\d{2}[/\\][0-9a-f]{6}-[0-9a-f]{8}\.jsonl$/.test(f))], [1, true]);
  eq("the refusal buffer is emptied", existsSync(rbufFile), false);
  const rlines = readFileSync(join(rrepo, "ai", "usage", rfiles[0]), "utf8").split("\n").filter(Boolean).length;
  eq("both refusals are in the file", rlines, 2);
  eq("refusals are not token records", loadRecords(join(rrepo, "ai", "usage")).recs.length, 0);
  const before = readFileSync(join(rrepo, "ai", "usage", rfiles[0]), "utf8");
  refuse("pre-commit.docs");
  spawnSync("node", [cli, "flush", "--idle"], { env: renv });
  const after = readdirSync(join(rrepo, "ai", "usage"), { recursive: true }).map(String).filter((f) => f.endsWith(".jsonl"));
  eq("a second flush writes a new file and never rewrites the first", [after.length, readFileSync(join(rrepo, "ai", "usage", rfiles[0]), "utf8") === before], [2, true]);

  // usage.enabled false: no refusal record, no flush
  writeFileSync(join(rrepo, "ai", "kit", "config.json"), JSON.stringify({ usage: { enabled: false } }));
  rmSync(rbuf, { recursive: true, force: true });
  refuse("pre-commit.docs");
  eq("usage.enabled false: refusal records nothing", existsSync(rbufFile), false);
  mkdirSync(join(rbuf, "refusals"), { recursive: true });
  writeFileSync(rbufFile, `${JSON.stringify({ v: 1, ts: "2030-01-01T00:00:00Z", rule: "x", kit: "1", branch: "b" })}\n`);
  spawnSync("node", [cli, "flush", "--idle"], { env: renv });
  eq("usage.enabled false: flush leaves the buffer", [existsSync(rbufFile), readdirSync(join(rrepo, "ai", "usage"), { recursive: true }).map(String).filter((f) => f.endsWith(".jsonl")).length], [true, 2]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
