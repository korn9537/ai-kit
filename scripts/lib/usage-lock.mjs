// The usage buffer lock (<git-common-dir>/claude-usage/.lock) and the per-session send lock.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export const LOCK_STALE_MS = 30 * 1000;
// Live holders need milliseconds; a hook must not stall (its timeout is 10 s), so a waiter gives up after this.
export const LOCK_WAIT_MS = 1500;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export const readText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};
export const HOST = hostname().replace(/:/g, "_");
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
export const ageOf = (path) => {
  const m = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
  return m === undefined ? undefined : Date.now() - m;
};
export const unlinkQuiet = (path) => {
  try {
    unlinkSync(path);
  } catch {}
};

// Removes the lock only while it still reads `seen` (an empty one only past LOCK_STALE_MS), holding `.lock.break` (wx,
// expires by age); true when the lock is gone.
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

// Runs fn holding the O_EXCL file "<pid>:<host>:<token>"; a dead PID on this host or an age past LOCK_STALE_MS breaks it
// (an empty one is live until then). Held past opts.deadline, else waitMs, else LOCK_WAIT_MS: throws code ELOCKED.
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


export const SEND_LOCK_STALE_MS = 10 * 60 * 1000;

// One send per session at a time: <session>.send.lock (wx) holds our token; one older than SEND_LOCK_STALE_MS is
// taken over. Returns a release function, or null when a live send holds it.
export function sendLock(bufDir, session) {
  mkdirSync(bufDir, { recursive: true });
  const lock = join(bufDir, `${session}.send.lock`);
  const token = `${process.pid}:${HOST}:${randomBytes(6).toString("hex")}`;
  for (let tries = 0; tries < 2; tries++) {
    try {
      writeFileSync(lock, token, { flag: "wx" });
      return () => {
        if (readText(lock) === token) unlinkQuiet(lock);
      };
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
    const seen = readText(lock);
    if (seen === null || !((seen !== "" && pidDead(seen)) || (ageOf(lock) ?? 0) > SEND_LOCK_STALE_MS)) return null;
    if (readText(lock) === seen) unlinkQuiet(lock);
  }
  return null;
}
