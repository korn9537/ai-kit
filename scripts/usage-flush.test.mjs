// Tests for the buffer lock, flush idempotence under parallel processes and parallel records.
// Usage: node scripts/usage-flush.test.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCK_STALE_MS, withLock } from "./usage-flush.mjs";
import { loadRecords } from "./usage-digest.mjs";

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
  writeFileSync(lock, "999999");
  const old = (Date.now() - LOCK_STALE_MS - 5000) / 1000;
  utimesSync(lock, old, old);
  eq("a stale lock does not block", withLock(bufDir, () => "ran"), "ran");

  // parallel records: three Stop hooks at once must sum to the transcript
  const transcript = join(tmp, "t.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ type: "user", timestamp: "2030-01-15T10:00:00Z", message: { role: "user", content: "ask" } })}\n`
    + `${JSON.stringify({ type: "assistant", timestamp: "2030-01-15T10:00:30Z", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1000, output_tokens: 1 } } })}\n`);
  const input = JSON.stringify({ session_id: "par", transcript_path: transcript, cwd: repo });
  await Promise.all([1, 2, 3].map(() => run("node", [cli, "record"], { env, input })));
  const lines = readFileSync(join(bufDir, "par.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  eq("three parallel records sum to the true input", lines.reduce((n, r) => n + r.agents.reduce((m, a) => m + (a.input ?? 0), 0), 0), 1000);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
