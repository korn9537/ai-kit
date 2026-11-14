// Sending to the usage API: a whole session's events (the transcripts are the buffer, the server upserts), the
// refusal buffer, the decider logs, and the one-time migrate of a repo's ai/usage/ files.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { postJson } from "./usage-api.mjs";
import { buildEvents, chunkEvents } from "./usage-events.mjs";
import { HOST, readText, sendLock, withLock } from "./usage-lock.mjs";

export const IDLE_MS = 6 * 3600 * 1000;
const IDLE_CAP = 20;
const LOG_MAX = 1024 * 1024;
export const REFUSAL_BUF = join("refusals", "buffer.log");
const USAGE_CLI = join(fileURLToPath(new URL(".", import.meta.url)), "..", "usage.mjs");

const writeAtomic = (path, text) => {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
};
const jsonLines = (text) =>
  String(text ?? "").split("\n").map((l) => {
    if (!l.trim()) return undefined;
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  });

// <session>.transcript: the path record() saw, so an idle pass can find the session's files.
export const transcriptOf = (bufDir, session) => readText(join(bufDir, `${session}.transcript`))?.trim() ?? "";
export function saveTranscriptPath(bufDir, session, path) {
  if (!path || transcriptOf(bufDir, session) === path) return;
  mkdirSync(bufDir, { recursive: true });
  writeAtomic(join(bufDir, `${session}.transcript`), path);
}

// <session>.sent: {transcript, bytes} of the last send whose every POST got 2xx.
export function readSent(bufDir, session) {
  try {
    const s = JSON.parse(readFileSync(join(bufDir, `${session}.sent`), "utf8"));
    return s && typeof s === "object" ? s : null;
  } catch {
    return null;
  }
}

// Size of the main transcript plus its subagent files (the dirs usage-collect's sessionFiles reads); null when the
// main one is gone.
export function sessionBytes(transcript) {
  const main = statSync(transcript, { throwIfNoEntry: false });
  if (!main?.isFile()) return null;
  const sizes = (dir) => {
    try {
      return readdirSync(dir).filter((n) => n.startsWith("agent-") && n.endsWith(".jsonl"))
        .reduce((n, f) => n + (statSync(join(dir, f), { throwIfNoEntry: false })?.size ?? 0), 0);
    } catch {
      return 0;
    }
  };
  const subDir = join(dirname(transcript), basename(transcript, ".jsonl"), "subagents");
  let n = main.size + sizes(subDir);
  try {
    for (const r of readdirSync(join(subDir, "workflows"))) n += sizes(join(subDir, "workflows", r));
  } catch {}
  return n;
}

// ctx: { root, bufDir, session, base, project, user, host, kit }. Posts nothing when the files are as last sent.
export async function sendSession(ctx, { maxBytes, maxRows } = {}) {
  const { bufDir, session } = ctx;
  const release = sendLock(bufDir, session);
  if (!release) return { status: "locked" };
  try {
    const transcript = transcriptOf(bufDir, session);
    if (!transcript || !existsSync(transcript)) return { status: "missing" };
    const sent = readSent(bufDir, session);
    const now = sessionBytes(transcript);
    if (sent && sent.transcript === transcript && sent.bytes === now) return { status: "unchanged" };
    const kits = jsonLines(readText(join(bufDir, `${session}.jsonl`))).filter((r) => r && typeof r.ts === "string" && typeof r.kit === "string")
      .map((r) => ({ ts: r.ts, kit: r.kit }));
    const built = buildEvents(transcript, { ...ctx, kit: kits[kits.length - 1]?.kit ?? ctx.kit, kits });
    if (!built) return { status: "missing" };
    const chunks = chunkEvents(ctx.project, built.tables, { maxBytes, maxRows });
    for (const c of chunks) await postJson(ctx.base, "/v1/events", c);
    writeAtomic(join(bufDir, `${session}.sent`), JSON.stringify({ transcript, bytes: built.bytes, at: new Date().toISOString() }));
    return { status: "sent", posts: chunks.length, rows: Object.fromEntries(Object.entries(built.tables).map(([k, v]) => [k, v.length])) };
  } finally {
    release();
  }
}

// Sessions to send at session start: not `except`, transcript idle over IDLE_MS and grown since its .sent; newest first.
export function idleSessions(bufDir, except = "", now = Date.now()) {
  let names = [];
  try {
    names = readdirSync(bufDir).filter((n) => n.endsWith(".transcript"));
  } catch {}
  const out = [];
  for (const n of names) {
    const session = n.slice(0, -".transcript".length);
    const transcript = transcriptOf(bufDir, session);
    if (session === except || !transcript) continue;
    const mtime = statSync(transcript, { throwIfNoEntry: false })?.mtimeMs;
    if (mtime === undefined || now - mtime <= IDLE_MS) continue;
    const sent = readSent(bufDir, session);
    // a .sent written after the transcript's last write needs no size scan
    const sentAt = statSync(join(bufDir, `${session}.sent`), { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (sent && sent.transcript === transcript && sentAt >= mtime) continue;
    const bytes = sessionBytes(transcript);
    if (bytes === null || (sent && sent.transcript === transcript && sent.bytes >= bytes)) continue;
    out.push({ session, mtime });
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, IDLE_CAP).map((x) => x.session);
}

// Refusals: the buffer is taken (renamed to refusals/out-*.log) under the buffer lock, posted outside it, and each out
// file deleted only on 2xx; a failed one waits for the next send.
export async function sendRefusals(bufDir, base, project) {
  const dir = join(bufDir, "refusals");
  if (existsSync(join(bufDir, REFUSAL_BUF))) {
    try {
      withLock(bufDir, () => {
        if (existsSync(join(bufDir, REFUSAL_BUF))) renameSync(join(bufDir, REFUSAL_BUF), join(dir, `out-${Date.now()}-${randomBytes(4).toString("hex")}.log`));
      });
    } catch (e) {
      if (e?.code !== "ELOCKED") throw e;
    }
  }
  let outs = [];
  try {
    outs = readdirSync(dir).filter((n) => /^out-.*\.log$/.test(n)).sort();
  } catch {}
  let sent = 0;
  for (const n of outs) {
    const items = jsonLines(readText(join(dir, n))).filter((r) => r && typeof r.ts === "string" && typeof r.rule === "string")
      .map(({ v, ...r }) => ({ ...r, host: r.host ?? HOST }));
    if (items.length) await postJson(base, "/v1/refusals", { project, items });
    unlinkSync(join(dir, n));
    sent += items.length;
  }
  return sent;
}

// Decider logs <logDir>/<session>.<agent>.jsonl: seq = line index; on 2xx the file goes and a .sent marker stays,
// so decider.mjs sync does not write it again.
export async function sendDecisions(logDir, base, project) {
  let names = [];
  try {
    names = readdirSync(logDir).filter((n) => n.endsWith(".jsonl")).sort();
  } catch {}
  let sent = 0;
  for (const n of names) {
    const path = join(logDir, n);
    const items = jsonLines(readText(path)).filter((x) => x !== undefined).flatMap((r, seq) =>
      r && typeof r.ts === "string" && typeof r.session === "string" && typeof r.agent === "string" ? [{ ...r, seq }] : []);
    if (items.length) await postJson(base, "/v1/decisions", { project, items });
    writeFileSync(`${path.slice(0, -".jsonl".length)}.sent`, "");
    unlinkSync(path);
    sent += items.length;
  }
  return sent;
}

export function pendingExtras(bufDir, logDir) {
  const has = (dir, re) => {
    try {
      return readdirSync(dir).some((n) => re.test(n));
    } catch {
      return false;
    }
  };
  return existsSync(join(bufDir, REFUSAL_BUF)) || has(join(bufDir, "refusals"), /^out-.*\.log$/) || has(logDir, /\.jsonl$/);
}

// Detached `usage.mjs send ...`: the hook returns at once; its stderr goes to <bufDir>/send.log (cut past 1 MiB).
export function spawnSend(root, bufDir, args) {
  mkdirSync(bufDir, { recursive: true });
  const logPath = join(bufDir, "send.log");
  if ((statSync(logPath, { throwIfNoEntry: false })?.size ?? 0) > LOG_MAX) truncateSync(logPath, 0);
  const fd = openSync(logPath, "a");
  try {
    const child = spawn(process.execPath, [USAGE_CLI, "send", ...args], {
      cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, detached: true, stdio: ["ignore", "ignore", fd],
    });
    child.on("error", () => {});
    child.unref();
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

// ai/usage/** as the server's legacy, refusal and decision items; a v1 record without session, ts or round is dropped.
export function readLegacy(usageDir) {
  const out = { records: [], refusals: [], decisions: [], dropped: 0 };
  let files = [];
  try {
    files = readdirSync(usageDir, { recursive: true }).map(String).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return null;
  }
  for (const f of files) {
    const rel = relative(usageDir, join(usageDir, f)).split(sep).join("/");
    const lines = jsonLines(readText(join(usageDir, f))).filter((x) => x !== undefined);
    if (rel.startsWith("refusals/")) {
      const host = rel.split("/").pop().split("-")[0];
      for (const r of lines) {
        if (r && typeof r.ts === "string" && typeof r.rule === "string") out.refusals.push({ ...r, host });
        else out.dropped++;
      }
    } else if (rel.startsWith("decisions/")) {
      lines.forEach((r, seq) => {
        if (r && typeof r.ts === "string" && typeof r.session === "string" && typeof r.agent === "string") out.decisions.push({ ...r, seq });
        else out.dropped++;
      });
    } else {
      for (const r of lines) {
        if (r && typeof r.session === "string" && r.session && !Number.isNaN(Date.parse(r.ts)) && Number.isInteger(r.round)) out.records.push(r);
        else out.dropped++;
      }
    }
  }
  return out;
}

export async function postLegacy(base, project, legacy) {
  const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  for (const items of chunks(legacy.records, 2000)) await postJson(base, "/v1/legacy", { project, items });
  for (const items of chunks(legacy.refusals, 5000)) await postJson(base, "/v1/refusals", { project, items });
  for (const items of chunks(legacy.decisions, 5000)) await postJson(base, "/v1/decisions", { project, items });
}
