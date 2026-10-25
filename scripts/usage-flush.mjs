// The Stop hook buffers records in <git-common-dir>/claude-usage/<session>.jsonl (state, shared by every branch and
// worktree). Flush copies the not-yet-flushed lines into ai/usage/<YYYY-MM>/ as new files and never modifies one.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const IDLE_MS = 6 * 3600 * 1000;

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
export function flushSession(root, bufDir, session) {
  const lines = linesOf(join(bufDir, `${session}.jsonl`));
  if (!lines) return null;
  const sidecar = join(bufDir, `${session}.flushed`);
  const [done = 0, files = 0] = (linesOf(sidecar)?.[0] ?? "").split(" ").map((x) => Number.parseInt(x, 10) || 0);
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

// Every buffer other than `except` whose last write is older than IDLE_MS; returns the files written.
export function flushIdle(root, bufDir, except = "", now = Date.now()) {
  let names = [];
  try {
    names = readdirSync(bufDir).filter((n) => n.endsWith(".jsonl")).sort();
  } catch {}
  const out = [];
  for (const n of names) {
    const session = n.slice(0, -".jsonl".length);
    if (session === except || now - (statSync(join(bufDir, n), { throwIfNoEntry: false })?.mtimeMs ?? now) <= IDLE_MS) continue;
    const f = flushSession(root, bufDir, session);
    if (f) out.push(f);
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
  const lines = found.sort((a, b) => a.n - b.n).flatMap((f) => linesOf(f.path) ?? []);
  if (!lines.length) return;
  mkdirSync(bufDir, { recursive: true });
  writeFileSync(buf, `${lines.join("\n")}\n`);
  setFlushed(join(bufDir, `${session}.flushed`), lines.length, found.length);
}
