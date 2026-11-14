// Sending to the usage API: a whole session's events (the transcripts are the buffer, the server upserts), the
// refusal buffer, the decider logs, and the one-time migrate of a repo's ai/usage/ files.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { postJson } from "./usage-api.mjs";
import { buildEvents, chunkEvents, clean, isInt32, isKey, tsOk } from "./usage-events.mjs";
import { HOST, readText, sendLock, withLock } from "./usage-lock.mjs";

export const IDLE_MS = 6 * 3600 * 1000;
// a decider log younger than this may still be in writing (an older kit wrote it in place)
const FRESH_MS = 5000;
const IDLE_CAP = 20;
const LOG_MAX = 1024 * 1024;
export const REFUSAL_BUF = join("refusals", "buffer.log");
const USAGE_CLI = join(fileURLToPath(new URL(".", import.meta.url)), "..", "usage.mjs");

const writeAtomic = (path, text) => {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
};
// statuses where the server refuses the data itself (bad input, body too large), so a resend cannot succeed; any other
// non-2xx (404, 405, 408, 429, a proxy's 502-504 while the server redeploys) is retried by a later send
export const PERMANENT_STATUS = [400, 413];
const isPermanent = (e) => PERMANENT_STATUS.includes(e?.status);
// a 429 stops the rest of a send pass: the next pass retries
export const isThrottled = (e) => e?.status === 429;
// a decider tmp file older than this was left by a crash (decider.mjs logDeciders links and unlinks it at once)
const TMP_MS = 10 * 60 * 1000;
// a line of send.log (the detached send's stderr)
const logLine = (msg) => process.stderr.write(`${new Date().toISOString()} usage send: ${String(msg).replace(/\s+/g, " ")}\n`);
// unlink or rename that another send may have done first
const unlessGone = (fn) => {
  try {
    fn();
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
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

// <session>.transcript: line 1 the transcript path record() saw, line 2 the session's project root (a one-line file has
// none), so an idle pass run from another worktree finds the session's files and its own worktree.
const transcriptLines = (bufDir, session) => (readText(join(bufDir, `${session}.transcript`)) ?? "").split("\n").map((l) => l.trim());
export const transcriptOf = (bufDir, session) => transcriptLines(bufDir, session)[0];
export const sessionRootOf = (bufDir, session) => transcriptLines(bufDir, session)[1] ?? "";
export function saveTranscriptPath(bufDir, session, path, root = "") {
  if (!path) return;
  const [was, wasRoot = ""] = transcriptLines(bufDir, session);
  const keep = root || wasRoot;
  if (was === path && wasRoot === keep) return;
  mkdirSync(bufDir, { recursive: true });
  writeAtomic(join(bufDir, `${session}.transcript`), keep ? `${path}\n${keep}\n` : path);
}

// <session>.sent: {transcript, bytes} of the last send whose every POST got 2xx, or with {rejected, error} of one the
// server refused with a PERMANENT_STATUS: that size is not sent again.
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

// ctx: { bufDir, session, base, project, user, host, kit }; the session's root comes from its .transcript, never from
// the sending worktree. Posts nothing when the files are as last sent; a gone transcript drops its .transcript.
export async function sendSession(ctx, { maxBytes, maxRows } = {}) {
  const { bufDir, session } = ctx;
  const release = sendLock(bufDir, session);
  if (!release) return { status: "locked" };
  try {
    const transcript = transcriptOf(bufDir, session);
    if (!transcript) return { status: "missing" };
    if (!existsSync(transcript)) {
      unlessGone(() => unlinkSync(join(bufDir, `${session}.transcript`)));
      return { status: "missing", removed: transcript };
    }
    const sent = readSent(bufDir, session);
    const now = sessionBytes(transcript);
    if (sent && sent.transcript === transcript && sent.bytes === now) return { status: "unchanged", ...(sent.rejected ? { rejected: true } : {}) };
    const kits = jsonLines(readText(join(bufDir, `${session}.jsonl`))).filter((r) => r && typeof r.ts === "string" && typeof r.kit === "string")
      .map((r) => ({ ts: r.ts, kit: r.kit }));
    const built = buildEvents(transcript, { ...ctx, root: sessionRootOf(bufDir, session), kit: kits[kits.length - 1]?.kit ?? ctx.kit, kits });
    if (!built) return { status: "missing" };
    const chunks = chunkEvents(ctx.project, built.tables, { maxBytes, maxRows });
    const mark = (extra = {}) =>
      writeAtomic(join(bufDir, `${session}.sent`), JSON.stringify({ transcript, bytes: built.bytes, at: new Date().toISOString(), ...extra }));
    try {
      for (const c of chunks) await postJson(ctx.base, "/v1/events", c);
    } catch (e) {
      if (!isPermanent(e)) throw e;
      mark({ rejected: true, error: e.message.slice(0, 500) });
      return { status: "rejected", error: e.message, dropped: built.dropped };
    }
    mark();
    return { status: "sent", posts: chunks.length, dropped: built.dropped, rows: Object.fromEntries(Object.entries(built.tables).map(([k, v]) => [k, v.length])) };
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

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const refusalOk = (r) => isObj(r) && tsOk(r.ts) && isKey(r.rule);
const decisionOk = (r) => isObj(r) && tsOk(r.ts) && isKey(r.session) && isKey(r.agent);
// a v1 record: what legacyBatch needs, and its integers within the int4 and int8 columns they land in
const fits = (v, ok) => !Number.isInteger(v) || ok(v);
const legacyOk = (r) => isObj(r) && isKey(r.session) && tsOk(r.ts) && isInt32(r.round)
  && ["prompt_chars", "duration_s", "base_context"].every((k) => fits(r[k], isInt32))
  && (!Array.isArray(r.agents) || r.agents.every((a) => !isObj(a) || (["calls", "peak", "largest_result"].every((k) => fits(a[k], isInt32))
    && ["input", "read", "write_5m", "write_1h", "output"].every((k) => fits(a[k], Number.isSafeInteger)))));

// Items in POSTs of at most maxItems and about maxBytes each (the server takes 20000 items and 32 MiB a body).
export async function postItems(base, path, project, items, { maxItems = 5000, maxBytes = 8 * 1024 * 1024 } = {}) {
  let cur = [];
  let bytes = 0;
  const post = async () => {
    if (cur.length) await postJson(base, path, { project, items: cur });
    cur = [];
    bytes = 0;
  };
  for (const it of items) {
    const n = Buffer.byteLength(JSON.stringify(it)) + 1;
    if (cur.length && (cur.length >= maxItems || bytes + n > maxBytes)) await post();
    cur.push(it);
    bytes += n;
  }
  await post();
}

// One file's items posted: 2xx → done(); a PERMANENT_STATUS → the file kept as <name>.rejected with the error in
// send.log; any other HTTP error → into errors, the file left for the next send and the next file still tried, but a
// 429 is thrown with the errors so far to end the pass; unreachable → thrown, as every file would fail.
async function postFile(path, post, done, errors, log) {
  try {
    await post();
  } catch (e) {
    if (isPermanent(e)) {
      unlessGone(() => renameSync(path, `${path}.rejected`));
      log(`${basename(path)} rejected, kept as ${basename(path)}.rejected: ${e.message}`);
      return 0;
    }
    if (!e?.status) throw e;
    errors.push(`${basename(path)}: ${e.message}`);
    if (isThrottled(e)) throw Object.assign(new Error(errors.join("; ")), { status: e.status });
    return 0;
  }
  done();
  return 1;
}

// Refusals: the buffer is taken (renamed to refusals/out-*.log) under the buffer lock, posted outside it, and each out
// file deleted only on 2xx; a failed one waits for the next send. Two sends may post one file: the server upserts.
export async function sendRefusals(bufDir, base, project, { log = logLine } = {}) {
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
  const errors = [];
  for (const n of outs) {
    const path = join(dir, n);
    const text = readText(path);
    if (text === null) continue;
    const lines = jsonLines(text).filter((x) => x !== undefined);
    const items = lines.filter(refusalOk).map(({ v, ...r }) => clean({ ...r, host: r.host ?? HOST }));
    if (items.length < lines.length) log(`${n}: ${lines.length - items.length} invalid line(s) dropped`);
    const post = () => postItems(base, "/v1/refusals", project, items);
    if (await postFile(path, post, () => unlessGone(() => unlinkSync(path)), errors, log)) sent += items.length;
  }
  if (errors.length) throw new Error(errors.join("; "));
  return sent;
}

// Decider logs <logDir>/<session>.<agent>.jsonl: seq = line index; on 2xx the file goes and a .sent marker stays,
// so decider.mjs sync does not write it again. A fresh file waits for a later send; an empty one past FRESH_MS is
// marked sent with no POST; a <name>.jsonl.<pid>.tmp past TMP_MS (a crashed logDeciders) is deleted.
export async function sendDecisions(logDir, base, project, { log = logLine, now = Date.now() } = {}) {
  let names = [];
  try {
    names = readdirSync(logDir).sort();
  } catch {}
  for (const n of names.filter((x) => /\.jsonl\.\d+\.tmp$/.test(x))) {
    const mtime = statSync(join(logDir, n), { throwIfNoEntry: false })?.mtimeMs;
    if (mtime !== undefined && now - mtime > TMP_MS) unlessGone(() => unlinkSync(join(logDir, n)));
  }
  let sent = 0;
  const errors = [];
  for (const n of names.filter((x) => x.endsWith(".jsonl"))) {
    const path = join(logDir, n);
    const st = statSync(path, { throwIfNoEntry: false });
    if (!st || now - st.mtimeMs < FRESH_MS) continue;
    const done = () => {
      writeFileSync(`${path.slice(0, -".jsonl".length)}.sent`, "");
      unlessGone(() => unlinkSync(path));
    };
    if (!st.size) {
      done();
      continue;
    }
    const text = readText(path);
    if (text === null) continue;
    const lines = jsonLines(text).filter((x) => x !== undefined);
    const items = lines.flatMap((r, seq) => (decisionOk(r) ? [clean({ ...r, seq })] : []));
    if (items.length < lines.length) log(`${n}: ${lines.length - items.length} invalid line(s) dropped`);
    if (await postFile(path, () => postItems(base, "/v1/decisions", project, items), done, errors, log)) sent += items.length;
  }
  if (errors.length) throw new Error(errors.join("; "));
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

// ai/usage/** as the server's legacy, refusal and decision items; a line the server would refuse counts as dropped.
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
        if (refusalOk(r)) out.refusals.push(clean({ ...r, host }));
        else out.dropped++;
      }
    } else if (rel.startsWith("decisions/")) {
      lines.forEach((r, seq) => {
        if (decisionOk(r)) out.decisions.push(clean({ ...r, seq }));
        else out.dropped++;
      });
    } else {
      for (const r of lines) {
        if (legacyOk(r)) out.records.push(clean(r));
        else out.dropped++;
      }
    }
  }
  return out;
}

export async function postLegacy(base, project, legacy, { maxBytes } = {}) {
  await postItems(base, "/v1/legacy", project, legacy.records, { maxItems: 2000, maxBytes });
  await postItems(base, "/v1/refusals", project, legacy.refusals, { maxBytes });
  await postItems(base, "/v1/decisions", project, legacy.decisions, { maxBytes });
}
