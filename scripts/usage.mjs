#!/usr/bin/env node
// Token usage CLI. `record` (Stop) appends the round's record to the local buffer <git-common-dir>/claude-usage/ and
// prints the summary line; `end` (SessionEnd) and `flush --idle` (SessionStart) start a detached `send` to the usage API.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib/is-main.mjs";
import { deciderDir, usageBufDir, usageCacheDir } from "./lib/state-dirs.mjs";
import { collectSession, loadCache, mergeCommits, saveCache, transcriptsDir } from "./lib/usage-collect.mjs";
import { formatHooks, scanHooks } from "./lib/hook-events.mjs";
import { formatHandoffs, scanHandoffs } from "./lib/handoff-audit.mjs";
import { flowGraph, flowHtml, formatFlow } from "./lib/usage-flow.mjs";
import { DEFAULT_PRICES, baselineRecords, buildRecord, compare, digest, enc, summaryLine } from "./lib/usage-digest.mjs";
import { HOST, LOCK_STALE_MS, LOCK_WAIT_MS, breakLock, withLock } from "./lib/usage-lock.mjs";
import { VIEW_FILTERS, endpointOf, formatTable, getAll, getJson, projectId } from "./lib/usage-api.mjs";
import {
  REFUSAL_BUF, idleSessions, isThrottled, pendingExtras, postLegacy, readLegacy, saveTranscriptPath, sendDecisions, sendRefusals, sendSession, spawnSend,
} from "./lib/usage-send.mjs";

export { LOCK_STALE_MS, breakLock, withLock };

const kitVersion = () => JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json"), "utf8")).version;
const REFUSAL_BUDGET_MS = 1500;

const git = (cwd, ...args) => gitWithin(5000, cwd, ...args);
const gitWithin = (timeout, cwd, ...args) => {
  try {
    return execFileSync("git", args, { windowsHide: true, cwd, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

// As hooks/lib.sh kit_project_root: the dir holding ai/kit/, else the git toplevel keeping the given spelling.
export function projectRoot(dir, gitMs = 5000) {
  let d = (dir || "/").replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  if (existsSync(join(d, "ai", "kit"))) return d;
  const prefix = gitWithin(gitMs, d, "rev-parse", "--show-prefix").replace(/\/+$/, "");
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

const linesOf = (path) => {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean);
  } catch {
    return null;
  }
};
const readLines = (path) =>
  (linesOf(path) ?? []).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });

// The project root when ai/kit/ is there and usage is on; "" otherwise.
function usageRoot(dir) {
  const root = projectRoot(dir);
  if (!existsSync(join(root, "ai", "kit")) || readConfig(root).usage?.enabled === false) return "";
  return root;
}

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
  saveTranscriptPath(bufDir, session, transcript, root);
  const cachePath = join(cacheDir, `${session}.json`);
  const cache = loadCache(cachePath);
  const sess = collectSession(transcript, cache);
  saveCache(cachePath, cache);

  const buffer = join(bufDir, `${session}.jsonl`);
  const user = git(root, "config", "user.name");
  const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD");
  const kit = kitVersion();
  // the lock deadline starts here, not at the process start: a cold transcript scan must not use it up
  lockWait.deadline ??= Date.now() + LOCK_WAIT_MS;
  // read, build and append under one lock: parallel records would each read the same prior
  withLock(
    bufDir,
    () => {
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

// refusal <rule-id>: a git hook refused a commit; appends {v, ts, rule, kit, branch} to the untracked refusal buffer,
// which `send` posts. Best effort: never throws on a held lock, never touches the network.
function refusal(rule) {
  if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(rule ?? "")) throw new Error("usage: usage.mjs refusal <rule-id>");
  // one budget from process start: git calls and the lock wait share it, so the hook is held at most REFUSAL_BUDGET_MS
  const deadline = Date.now() - process.uptime() * 1000 + REFUSAL_BUDGET_MS;
  const left = () => Math.max(0, Math.min(500, deadline - Date.now()));
  const root = projectRoot(process.cwd(), left() || 1);
  if (!existsSync(join(root, "ai", "kit")) || readConfig(root).usage?.enabled === false) return;
  const bufDir = usageBufDir(root, { timeout: left() || 1 });
  if (!bufDir) return;
  const branch = gitWithin(left() || 1, root, "rev-parse", "--abbrev-ref", "HEAD");
  const rec = { v: 1, ts: new Date().toISOString(), rule, kit: kitVersion(), branch };
  withLock(
    bufDir,
    () => {
      mkdirSync(join(bufDir, "refusals"), { recursive: true });
      appendFileSync(join(bufDir, REFUSAL_BUF), `${JSON.stringify(rec)}\n`);
    },
    { deadline },
  );
}

const val = (args, flag) => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? "") : "");
const deciderLog = (root) => {
  const d = deciderDir(root, { timeout: 5000 });
  return d ? join(d, "log") : "";
};

// flush --session <id> | flush --idle [--except <id>]: starts one detached send for that session, or for the idle
// sessions (and pending refusals and decider logs), and returns.
function flushCmd(args) {
  const root = usageRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root) return;
  const bufDir = usageBufDir(root, { timeout: 5000 });
  if (!bufDir) return;
  let sessions;
  if (args[0] === "--session" && val(args, "--session")) sessions = [val(args, "--session")];
  else if (args[0] === "--idle") sessions = idleSessions(bufDir, val(args, "--except"));
  else throw new Error("usage: usage.mjs flush --session <id> | --idle [--except <id>]");
  if (!sessions.length && !pendingExtras(bufDir, deciderLog(root))) return;
  spawnSend(root, bufDir, sessions.flatMap((s) => ["--session", s]));
}

// send [--session <id>]...: each session's events, then the refusal buffer and decider logs; run detached by end and
// flush. A failure leaves .sent (a start after 6 h idle retries); PERMANENT_STATUS marks the size rejected; 429 ends it
async function sendCmd(args) {
  const root = usageRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root) return;
  const bufDir = usageBufDir(root, { timeout: 5000 });
  if (!bufDir) throw new Error("not a git repository, nothing sent");
  const sessions = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && args[i + 1]) sessions.push(args[++i]);
    else throw new Error("usage: usage.mjs send [--session <id>]...");
  }
  const base = endpointOf(readConfig(root).usage ?? {});
  const project = projectId(root);
  const ctx = { root, bufDir, base, project, user: git(root, "config", "user.name"), host: HOST, kit: kitVersion() };
  const errors = [];
  const log = (m) => process.stderr.write(`${new Date().toISOString()} usage send: ${String(m).replace(/\s+/g, " ")}\n`);
  let throttled = false;
  const fail = (what, e) => {
    errors.push(`${what}: ${e.message}`);
    throttled = isThrottled(e);
  };
  for (const session of sessions) {
    if (throttled) break;
    try {
      const r = await sendSession({ ...ctx, session });
      if (r.removed) process.stdout.write(`${session}: transcript ${r.removed} is gone, nothing sent; its .transcript removed\n`);
      else if (process.stdout.isTTY || process.env.AI_KIT_USAGE_VERBOSE) process.stdout.write(`${session}: ${JSON.stringify(r)}\n`);
      if (r.dropped) log(`${session}: ${r.dropped} row(s) without a key the server needs, dropped`);
      if (r.status === "rejected") errors.push(`${session}: rejected, not sent again until its transcript grows: ${r.error}`);
    } catch (e) {
      fail(session, e);
    }
  }
  if (!throttled) {
    try {
      await sendRefusals(bufDir, base, project, { log });
    } catch (e) {
      fail("refusals", e);
    }
  }
  if (!throttled) {
    try {
      const logDir = deciderLog(root);
      if (logDir) await sendDecisions(logDir, base, project, { log });
    } catch (e) {
      fail("decisions", e);
    }
  }
  if (throttled) errors.push("rate limited (429): the rest of this send waits for the next one");
  if (errors.length) throw new Error(errors.join("; "));
}

// v1 records from GET /v1/records carry desc as plain text; digest() reads v1's base64, so it is encoded here.
export const fromApi = (items) =>
  items.map((x) => x?.item).filter(Boolean).map((r) => ({ ...r, agents: Array.isArray(r.agents) ? r.agents.map((a) => ({ ...a, desc: enc(a?.desc ?? "") })) : r.agents }));

// digest [--since YYYY-MM-DD] [--project] [--baseline] | digest --compare <kitA> <kitB>: the fixed-size digest of the
// usage API's records, every project unless --project (or of the local transcripts with --baseline). Reads only.
async function digestCmd(args) {
  let since = "";
  let baseline = false;
  let own = false;
  let kits = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--baseline") baseline = true;
    else if (args[i] === "--project") own = true;
    else if (args[i] === "--compare" && args[i + 1] && args[i + 2] && !args[i + 1].startsWith("--") && !args[i + 2].startsWith("--")) kits = [args[i + 1], args[(i += 2)]];
    else if (args[i] === "--since" && /^\d{4}-\d{2}-\d{2}$/.test(args[i + 1] ?? "")) since = args[++i];
    else throw new Error("usage: usage.mjs digest [--since YYYY-MM-DD] [--project] [--baseline] | digest --compare <kitA> <kitB> [--project]");
  }
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const conf = readConfig(root).usage ?? {};
  const prices = { ...DEFAULT_PRICES, ...(conf.prices ?? {}) };
  if (baseline) {
    const who = { project: basename(root), user: git(root, "config", "user.name") };
    const { recs, skipped } = baselineRecords(root, who, since);
    if (since && !recs.length && baselineRecords(root, who).recs.length) {
      process.stdout.write(`no records since ${since}\n`);
      return;
    }
    process.stdout.write(`${digest(recs, prices, { sessionsSkipped: skipped, source: "baseline" })}\n`);
    return;
  }
  const base = endpointOf(conf);
  const query = { since, project: own ? projectId(root) : "" };
  const recs = fromApi(await getAll(base, "/v1/records", query));
  const refusals = (await getAll(base, "/v1/refusals", query)).map((r) => ({ v: 1, ts: r.ts, rule: r.rule, kit: r.kit, branch: r.branch }));
  if (kits) {
    process.stdout.write(`${compare(recs, refusals, prices, kits[0], kits[1])}\n`);
    return;
  }
  if (since && !recs.length && (await getJson(base, "/v1/records", { project: query.project, limit: 1 })).items?.length) {
    process.stdout.write(`no records since ${since}\n`);
    return;
  }
  process.stdout.write(`${digest(recs, prices, { refusals })}\n`);
}

// views <view> [--kit <v|prefix.>] [--project] [--since YYYY-MM-DD]: one analysis view of the usage API as a table.
async function viewsCmd(args) {
  const view = args[0] ?? "";
  if (!/^v_[a-z0-9_]+$/.test(view)) throw new Error("usage: usage.mjs views <view> [--kit <version|prefix.>] [--project] [--since YYYY-MM-DD]");
  const q = {};
  let own = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--kit" && args[i + 1]) q.kit = args[++i];
    else if (args[i] === "--project") own = true;
    else if (args[i] === "--since" && /^\d{4}-\d{2}-\d{2}$/.test(args[i + 1] ?? "")) q.since = args[++i];
    else throw new Error("usage: usage.mjs views <view> [--kit <version|prefix.>] [--project] [--since YYYY-MM-DD]");
  }
  const f = VIEW_FILTERS[view];
  if (f && own && !f.project) throw new Error(`${view} is across projects: --project does not apply (use --kit)`);
  if (f && q.since && !f.since) throw new Error(`${view} has no date column: --since does not apply (use --kit)`);
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (own) q.project = projectId(root);
  const { items = [] } = await getJson(endpointOf(readConfig(root).usage ?? {}), `/v1/views/${view}`, { ...q, limit: 61 });
  process.stdout.write(`${formatTable(items, { cap: 60 })}\n`);
}

// flow [--kit <v|prefix.>] [--project] [--html <file>]: the process map of the main sessions from v_flow_nodes and
// v_flow_edges, as a text summary and optionally a self-contained HTML page.
async function flowCmd(args) {
  const q = {};
  let own = false;
  let html = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--kit" && args[i + 1]) q.kit = args[++i];
    else if (args[i] === "--project") own = true;
    else if (args[i] === "--html" && args[i + 1]) html = args[++i];
    else throw new Error("usage: usage.mjs flow [--kit <version|prefix.>] [--project] [--html <file>]");
  }
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (own) q.project = projectId(root);
  const base = endpointOf(readConfig(root).usage ?? {});
  const [nodes, edges] = await Promise.all(["v_flow_nodes", "v_flow_edges"].map((v) => getAll(base, `/v1/views/${v}`, q)));
  if (!nodes.length) {
    process.stdout.write("no flow rows: the server has no v_flow views yet, or nothing matches\n");
    return;
  }
  const g = flowGraph(nodes, edges);
  process.stdout.write(`${formatFlow(g, { kit: q.kit })}\n`);
  if (html) {
    writeFileSync(html, flowHtml(g, { kit: q.kit }));
    process.stdout.write(`map written to ${html}\n`);
  }
}

// migrate: posts this repo's ai/usage/** to the usage API; only when every POST got 2xx, stages its removal.
async function migrateCmd() {
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (readConfig(root).usage?.enabled === false) throw new Error("usage.enabled is false in ai/kit/config.json: nothing migrated");
  const legacy = readLegacy(join(root, "ai", "usage"));
  if (!legacy) {
    process.stdout.write("no ai/usage/ in this repo: nothing to migrate\n");
    return;
  }
  const project = projectId(root);
  await postLegacy(endpointOf(readConfig(root).usage ?? {}), project, legacy);
  execFileSync("git", ["rm", "-r", "-q", "--ignore-unmatch", "--", "ai/usage"], { windowsHide: true, cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  const left = existsSync(join(root, "ai", "usage")) ? " (untracked files left in ai/usage/: sent too, delete them by hand)" : "";
  process.stdout.write(`sent to ${project}: ${legacy.records.length} records, ${legacy.refusals.length} refusals, ${legacy.decisions.length} decisions`
    + `${legacy.dropped ? `, ${legacy.dropped} unusable lines skipped` : ""}; ai/usage/ removal staged${left}\n`
    + `commit it: git commit -m "chore: drop ai/usage, its records are in the usage API" -m "Job: <job id>"\n`);
}

// a real calendar day: Date.parse rolls an impossible one (February 30) into the next month
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "") && !isNaN(Date.parse(d)) && new Date(Date.parse(d)).toISOString().slice(0, 10) === d;

// handoffs [--since YYYY-MM-DD]: per subagent role in this machine's transcripts of the project, brief and report
// size and how often the parent re-read what a report had named. Prints counts only; writes nothing.
function handoffsCmd(args) {
  let since = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && isDay(args[i + 1])) since = args[++i];
    else throw new Error("usage: usage.mjs handoffs [--since YYYY-MM-DD]");
  }
  const dir = transcriptsDir(projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd()));
  if (!existsSync(dir)) return void process.stdout.write("no transcripts for this project\n");
  process.stdout.write(`${formatHandoffs(scanHandoffs(dir, { since }))}\n`);
}

// hooks [--since YYYY-MM-DD]: counts each kit hook's firings in this machine's transcripts of the project. Prints
// counts only; writes nothing.
async function hooksCmd(args) {
  let since = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && isDay(args[i + 1])) since = args[++i];
    else throw new Error("usage: usage.mjs hooks [--since YYYY-MM-DD]");
  }
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!existsSync(join(root, "ai", "kit"))) return void process.stdout.write("no ai/kit in this project: no hook counts\n");
  const dir = transcriptsDir(root);
  if (!existsSync(dir)) return void process.stdout.write("no transcripts for this project\n");
  // kit version per session from the local buffer records
  const kitOf = new Map();
  const bufDir = usageBufDir(root, { timeout: 5000 });
  let names = [];
  try {
    names = bufDir ? readdirSync(bufDir).filter((n) => n.endsWith(".jsonl")) : [];
  } catch {}
  for (const n of names) {
    const r = readLines(join(bufDir, n)).find((x) => x?.kit);
    if (r) kitOf.set(typeof r.session === "string" ? r.session : n.slice(0, -".jsonl".length), r.kit);
  }
  process.stdout.write(`${formatHooks(await scanHooks(dir, { since, kitOf }))}\n`);
}

const logErr = (e, tag = "kit-log") => process.stderr.write(`${tag}: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
const failWith = (tag) => (e) => {
  logErr(e, tag);
  process.exitCode = 2;
};

function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);
  if (cmd === "record") {
    try {
      record(JSON.parse(readFileSync(0, "utf8") || "{}"));
    } catch (e) {
      logErr(e);
    }
    return;
  }
  if (cmd === "end") {
    // SessionEnd: record what came after the last Stop (no summary), then start the detached send; a failed record
    // does not skip the send (the transcript is the buffer)
    let input = {};
    try {
      input = JSON.parse(readFileSync(0, "utf8") || "{}");
    } catch {}
    try {
      record(input, true);
    } catch (e) {
      logErr(e);
    }
    try {
      if (input.session_id) {
        const root = usageRoot(process.env.CLAUDE_PROJECT_DIR || input.cwd);
        const bufDir = root ? usageBufDir(root, { timeout: 5000 }) : "";
        if (bufDir) {
          if (input.transcript_path && existsSync(input.transcript_path)) saveTranscriptPath(bufDir, String(input.session_id), input.transcript_path, root);
          spawnSend(root, bufDir, ["--session", String(input.session_id)]);
        }
      }
    } catch (e) {
      logErr(e);
    }
    return;
  }
  if (cmd === "flush") {
    try {
      flushCmd(args);
    } catch (e) {
      logErr(e);
    }
    return;
  }
  if (cmd === "send") {
    sendCmd(args).catch((e) => {
      process.stderr.write(`${new Date().toISOString()} usage send: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
      process.exitCode = 2;
    });
    return;
  }
  if (cmd === "digest") return void digestCmd(args).catch(failWith("usage-digest"));
  if (cmd === "views") return void viewsCmd(args).catch(failWith("usage-views"));
  if (cmd === "flow") return void flowCmd(args).catch(failWith("usage-flow"));
  if (cmd === "migrate") return void migrateCmd().catch(failWith("usage-migrate"));
  if (cmd === "refusal") {
    try {
      refusal(args[0]);
    } catch (e) {
      logErr(e);
    }
    return;
  }
  if (cmd === "hooks") return void hooksCmd(args).catch(failWith("usage-hooks"));
  if (cmd === "handoffs") {
    try {
      return void handoffsCmd(args);
    } catch (e) {
      return void failWith("usage-handoffs")(e);
    }
  }
  process.stderr.write("usage: usage.mjs record | end | refusal <rule-id> | flush --session <id> | flush --idle [--except <id>] | send [--session <id>]..."
    + " | digest [--since YYYY-MM-DD] [--project] [--baseline | --compare <kitA> <kitB>] | views <view> [--kit <v>] [--project] [--since YYYY-MM-DD]"
    + " | flow [--kit <v>] [--project] [--html <file>] | migrate | hooks [--since YYYY-MM-DD] | handoffs [--since YYYY-MM-DD]\n");
  process.exitCode = 2;
}

if (isMain(import.meta.url)) main();
