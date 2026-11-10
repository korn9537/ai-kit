#!/usr/bin/env node
// Token usage CLI. `record` is the Stop hook: reads the hook JSON on stdin, appends this round's delta record to the
// buffer <git-common-dir>/claude-usage/<session>.jsonl and prints the one-line summary; nothing is written under
// ai/usage/. `end` (SessionEnd) records what came after the last Stop, then flushes that session. `flush` (SessionStart
// --idle) moves other sessions' buffered records into new files there. None ever fails, and none waits over 1.5 s for
// the lock.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./is-main.mjs";
import { usageBufDir, usageCacheDir } from "./lib/state-dirs.mjs";
import { collectSession, loadCache, mergeCommits, saveCache } from "./usage-collect.mjs";
import { DEFAULT_PRICES, baselineRecords, buildRecord, digest, loadRecords, summaryLine } from "./usage-digest.mjs";

const IDLE_MS = 6 * 3600 * 1000;

export const LOCK_STALE_MS = 30 * 1000;
// Live holders need milliseconds; a hook must not stall (its timeout is 10 s), so a waiter gives up after this.
const LOCK_WAIT_MS = 1500;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const readText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};
const HOST = hostname().replace(/:/g, "_");
// A PID means something only on the host that wrote it (a git dir shared with a container or WSL has other PIDs).
const pidDead = (text) => {
  const [pidText, host] = text.split(":");
  const pid = Number.parseInt(pidText, 10);
  if (!(pid > 0) || host !== HOST) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e?.code === "ESRCH";
  }
};
const ageOf = (path) => {
  const m = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
  return m === undefined ? undefined : Date.now() - m;
};
const unlinkQuiet = (path) => {
  try {
    unlinkSync(path);
  } catch {}
};

// Removes the lock seen with content `seen`, never moving it; true when the lock is gone. One process at a time holds
// `.lock.break` (wx); under it the lock is read again and removed only if it still equals `seen` (an empty one also
// only when it is past LOCK_STALE_MS, so a fresh holder's still-empty file is spared). A `.lock.break` left by a
// killed process expires by age.
export function breakLock(lock, seen) {
  const brk = `${lock}.break`;
  try {
    writeFileSync(brk, String(process.pid), { flag: "wx" });
  } catch (e) {
    if (e?.code !== "EEXIST") throw e;
    if ((ageOf(brk) ?? 0) > LOCK_STALE_MS) unlinkQuiet(brk);
    return false;
  }
  try {
    if (readText(lock) !== seen) return false;
    if (seen === "" && !((ageOf(lock) ?? 0) > LOCK_STALE_MS)) return false;
    try {
      unlinkSync(lock);
    } catch (e) {
      if (e?.code !== "ENOENT") return false;
    }
    return true;
  } finally {
    unlinkQuiet(brk);
  }
}

// Runs fn holding an O_EXCL lock file in the buffer dir, so parallel flushes and records take turns. The file holds
// "<pid>:<host>:<token>". A lock whose PID is gone on this host, or older than LOCK_STALE_MS, is broken at once; an
// empty file counts as live until it is that old (create and write are not atomic). One still held at the deadline
// (opts.deadline, else now + opts.waitMs, else LOCK_WAIT_MS) throws an error with code ELOCKED, as does one that
// cannot be read.
export function withLock(bufDir, fn, opts = {}) {
  mkdirSync(bufDir, { recursive: true });
  const lock = join(bufDir, ".lock");
  const token = `${process.pid}:${HOST}:${randomBytes(6).toString("hex")}`;
  const deadline = opts.deadline ?? Date.now() + (opts.waitMs ?? LOCK_WAIT_MS);
  for (;;) {
    try {
      writeFileSync(lock, token, { flag: "wx" });
      break;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
    const seen = readText(lock);
    if (seen !== null && ((seen !== "" && pidDead(seen)) || (ageOf(lock) ?? 0) > LOCK_STALE_MS) && breakLock(lock, seen)) continue;
    if (Date.now() >= deadline) {
      throw Object.assign(new Error("usage buffer is locked by another process"), { code: "ELOCKED" });
    }
    sleep(20);
  }
  try {
    return fn();
  } finally {
    if (readText(lock) === token) {
      try {
        unlinkSync(lock);
      } catch {}
    }
  }
}

const linesOf = (path) => {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean);
  } catch {
    return null;
  }
};

// The sidecar holds "<lines flushed> <files written>": the file count names the next file, so branches that each
// flushed the session never pick the same name.
function setFlushed(sidecar, lines, files) {
  const tmp = `${sidecar}.${process.pid}.tmp`;
  writeFileSync(tmp, `${lines} ${files}`);
  renameSync(tmp, sidecar);
}

// Writes the buffer's new lines to <session>.jsonl, or <session>.2.jsonl, .3, ... for a resumed session.
function flushSession(root, bufDir, session, opts) {
  return withLock(bufDir, () => flushLocked(root, bufDir, session), opts);
}

const flushedOf = (bufDir, session) =>
  (linesOf(join(bufDir, `${session}.flushed`))?.[0] ?? "").split(" ").map((x) => Number.parseInt(x, 10) || 0);

function flushLocked(root, bufDir, session) {
  const lines = linesOf(join(bufDir, `${session}.jsonl`));
  if (!lines) return null;
  const sidecar = join(bufDir, `${session}.flushed`);
  const [done = 0, files = 0] = flushedOf(bufDir, session);
  const fresh = lines.slice(done);
  if (!fresh.length) return null;
  let month = new Date().toISOString().slice(0, 7);
  try {
    const ts = JSON.parse(lines[0]).ts;
    if (/^\d{4}-\d{2}/.test(ts)) month = ts.slice(0, 7);
  } catch {}
  const dir = join(root, "ai", "usage", month);
  mkdirSync(dir, { recursive: true });
  for (let n = files + 1; ; n++) {
    const path = join(dir, n === 1 ? `${session}.jsonl` : `${session}.${n}.jsonl`);
    try {
      writeFileSync(path, `${fresh.join("\n")}\n`, { flag: "wx" });
      setFlushed(sidecar, lines.length, n);
      return path;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
  }
}

// Every buffer other than `except` with new lines whose last write is older than IDLE_MS; returns the files written.
// It tries the lock once and stops at a held one (the next session retries), so a session start never waits.
export function flushIdle(root, bufDir, except = "", now = Date.now()) {
  let names = [];
  try {
    names = readdirSync(bufDir).filter((n) => n.endsWith(".jsonl")).sort();
  } catch {}
  const out = [];
  for (const n of names) {
    const session = n.slice(0, -".jsonl".length);
    if (session === except || now - (statSync(join(bufDir, n), { throwIfNoEntry: false })?.mtimeMs ?? now) <= IDLE_MS) continue;
    if ((linesOf(join(bufDir, n))?.length ?? 0) <= (flushedOf(bufDir, session)[0] ?? 0)) continue;
    try {
      const f = flushSession(root, bufDir, session, { waitMs: 0 });
      if (f) out.push(f);
    } catch (e) {
      if (e?.code !== "ELOCKED") throw e;
      break;
    }
  }
  return out;
}

// A session whose buffer is gone (another machine, a fresh clone) starts from its records already in ai/usage/, all
// counted as flushed, so a resumed session is not counted twice.
export function seedBuffer(root, bufDir, session) {
  const buf = join(bufDir, `${session}.jsonl`);
  if (existsSync(buf)) return;
  const usage = join(root, "ai", "usage");
  const found = [];
  let months = [];
  try {
    months = readdirSync(usage).sort();
  } catch {}
  for (const m of months) {
    let names = [];
    try {
      names = readdirSync(join(usage, m));
    } catch {}
    for (const f of names) {
      const mid = f.startsWith(`${session}.`) && f.endsWith(".jsonl") ? f.slice(session.length + 1, -".jsonl".length) : "";
      if (mid === "" && f === `${session}.jsonl`) found.push({ n: 1, path: join(usage, m, f) });
      else if (/^\d+$/.test(mid)) found.push({ n: Number(mid), path: join(usage, m, f) });
    }
  }
  const lines = [...new Set(found.sort((a, b) => a.n - b.n).flatMap((f) => linesOf(f.path) ?? []))];
  if (!lines.length) return;
  mkdirSync(bufDir, { recursive: true });
  writeFileSync(buf, `${lines.join("\n")}\n`);
  setFlushed(join(bufDir, `${session}.flushed`), lines.length, found.length);
}

const git = (cwd, ...args) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

// As hooks/lib.sh kit_project_root: the dir holding ai/kit/, else the git toplevel keeping the given spelling.
export function projectRoot(dir) {
  let d = (dir || "/").replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  if (existsSync(join(d, "ai", "kit"))) return d;
  const prefix = git(d, "rev-parse", "--show-prefix").replace(/\/+$/, "");
  if (prefix && d.endsWith(`/${prefix}`)) d = d.slice(0, -(prefix.length + 1));
  return d || "/";
}

function readConfig(root) {
  try {
    return JSON.parse(readFileSync(join(root, "ai", "kit", "config.json"), "utf8"));
  } catch {
    return {};
  }
}

const readLines = (path) =>
  (linesOf(path) ?? []).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });

function record(input, quiet = false, lockWait = {}) {
  const session = input.session_id;
  const transcript = input.transcript_path;
  if (!session) throw new Error("no session_id in the hook input");
  if (!transcript) throw new Error("no transcript_path in the hook input");
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || input.cwd);
  if (!existsSync(join(root, "ai", "kit"))) return;
  const conf = readConfig(root).usage ?? {};
  if (conf.enabled === false) return;
  if (!statSync(transcript, { throwIfNoEntry: false })?.isFile()) throw new Error(`cannot read transcript ${transcript}`);

  const cacheDir = usageCacheDir(root, { timeout: 5000 });
  const bufDir = usageBufDir(root, { timeout: 5000 });
  if (!cacheDir || !bufDir) throw new Error("not a git repository, usage not recorded");
  const cachePath = join(cacheDir, `${session}.json`);
  const cache = loadCache(cachePath);
  const sess = collectSession(transcript, cache);
  saveCache(cachePath, cache);

  const buffer = join(bufDir, `${session}.jsonl`);
  const user = git(root, "config", "user.name");
  const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD");
  const kit = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json"), "utf8")).version;
  // the lock deadline starts here, not at the process start: a cold transcript scan must not use it up
  lockWait.deadline ??= Date.now() + LOCK_WAIT_MS;
  // seed, read, build and append under one lock: parallel records would each read the same prior
  withLock(
    bufDir,
    () => {
      seedBuffer(root, bufDir, session);
      const prior = readLines(buffer);
      // `git commit -q` prints no hash, so HEAD's commits since the last record (first record: since this round's
      // prompt, not the transcript's start, which a fork or resume carries over) count too
      const since = prior.length ? prior[prior.length - 1].ts : sess.prompts[sess.prompts.length - 1]?.ts || sess.firstTs;
      if (since) sess.commits = mergeCommits(sess.commits, git(root, "log", "-n", "500", `--since=${since}`, "--format=%H %h %cI", "HEAD"));
      const rec = buildRecord(sess, prior, { now: new Date(), session, kit, project: basename(root), user, branch });
      if (!rec) return;
      appendFileSync(buffer, `${JSON.stringify(rec)}\n`);
      if (quiet) return;
      const prices = { ...DEFAULT_PRICES, ...(conf.prices ?? {}) };
      process.stdout.write(`${JSON.stringify({ systemMessage: summaryLine(rec, [...prior, rec], prices, { money: conf.money !== false }) })}\n`);
    },
    { deadline: lockWait.deadline },
  );
}

// flush --session <id> | flush --idle [--except <id>]: moves buffered records into ai/usage/ (never modifies a file there).
function flushCmd(args, deadline) {
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!existsSync(join(root, "ai", "kit")) || readConfig(root).usage?.enabled === false) return;
  const bufDir = usageBufDir(root, { timeout: 5000 });
  if (!bufDir) return;
  const val = (flag) => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? "") : "");
  if (args[0] === "--session" && val("--session")) flushSession(root, bufDir, val("--session"), { deadline });
  else if (args[0] === "--idle") flushIdle(root, bufDir, val("--except"));
  else throw new Error("usage: usage.mjs flush --session <id> | --idle [--except <id>]");
}

// digest [--since YYYY-MM-DD] [--baseline]: prints the fixed-size digest of ai/usage/** (or of the local transcripts
// with --baseline, in memory only). Reads only; writes nothing.
function digestCmd(args) {
  let since = "";
  let baseline = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--baseline") baseline = true;
    else if (args[i] === "--since" && /^\d{4}-\d{2}-\d{2}$/.test(args[i + 1] ?? "")) since = args[++i];
    else throw new Error("usage: usage.mjs digest [--since YYYY-MM-DD] [--baseline]");
  }
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const prices = { ...DEFAULT_PRICES, ...(readConfig(root).usage?.prices ?? {}) };
  if (!baseline) {
    const { recs, bad, skipped } = loadRecords(join(root, "ai", "usage"), since);
    if (since && !recs.length && loadRecords(join(root, "ai", "usage")).recs.length) {
      process.stdout.write(`no records since ${since}\n`);
      return;
    }
    process.stdout.write(`${digest(recs, prices, { bad, skipped })}\n`);
    return;
  }
  const who = { project: basename(root), user: git(root, "config", "user.name") };
  const { recs, skipped } = baselineRecords(root, who, since);
  if (since && !recs.length && baselineRecords(root, who).recs.length) {
    process.stdout.write(`no records since ${since}\n`);
    return;
  }
  process.stdout.write(`${digest(recs, prices, { sessionsSkipped: skipped, source: "baseline" })}\n`);
}

function main() {
  const cmd = process.argv[2];
  if (cmd === "record") {
    try {
      record(JSON.parse(readFileSync(0, "utf8") || "{}"));
    } catch (e) {
      process.stderr.write(`kit-log: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
    }
    return;
  }
  if (cmd === "end") {
    // SessionEnd: record what came after the last Stop (no summary), then flush; one process and one lock deadline
    // (started at the first lock wait) for both steps. A failure of the first step does not skip the second, except
    // a lock wait that timed out: the lock is still held, so the second would only wait again.
    const lockWait = {};
    let locked = false;
    let input = {};
    try {
      input = JSON.parse(readFileSync(0, "utf8") || "{}");
    } catch {}
    try {
      record(input, true, lockWait);
    } catch (e) {
      locked = e?.code === "ELOCKED";
      process.stderr.write(`kit-log: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
    }
    try {
      if (input.session_id && !locked) flushCmd(["--session", String(input.session_id)], lockWait.deadline);
    } catch (e) {
      process.stderr.write(`kit-log: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
    }
    return;
  }
  if (cmd === "flush") {
    try {
      flushCmd(process.argv.slice(3));
    } catch (e) {
      process.stderr.write(`kit-log: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
    }
    return;
  }
  if (cmd === "digest") {
    try {
      digestCmd(process.argv.slice(3));
    } catch (e) {
      process.stderr.write(`usage-digest: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
      process.exitCode = 2;
    }
    return;
  }
  process.stderr.write("usage: usage.mjs record | end | flush --session <id> | flush --idle | digest [--since YYYY-MM-DD] [--baseline]\n");
  process.exitCode = 2;
}

if (isMain(import.meta.url)) main();
