// The Stop hook buffers records in <git-common-dir>/claude-usage/<session>.jsonl (state, shared by every branch and
// worktree). Flush copies the not-yet-flushed lines into ai/usage/<YYYY-MM>/ as new files and never modifies one.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export const IDLE_MS = 6 * 3600 * 1000;

export const LOCK_STALE_MS = 30 * 1000;
// Live holders need milliseconds; a hook must not stall (its timeout is 10 s), so a waiter gives up after this.
export const LOCK_WAIT_MS = 1500;

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
export function flushSession(root, bufDir, session, opts) {
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
