#!/usr/bin/env node
// Token usage CLI. `record` is the Stop hook: reads the hook JSON on stdin, appends this round's delta record to the
// buffer <git-common-dir>/claude-usage/<session>.jsonl and prints the one-line summary; nothing is written under
// ai/usage/. `flush` (SessionEnd, SessionStart) moves buffered records into new files there. Neither ever fails.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectSession, loadCache, saveCache } from "./usage-collect.mjs";
import { baselineRecords, digest, loadRecords } from "./usage-digest.mjs";
import { flushIdle, flushSession, seedBuffer } from "./usage-flush.mjs";
import { DEFAULT_PRICES, DEFAULT_RATIOS, buildRecord, summaryLine } from "./usage-record.mjs";

const git = (cwd, ...args) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

// As hooks/lib.sh kit_project_root: the dir holding ai/kit/, else the git toplevel keeping the given spelling.
export function projectRoot(dir) {
  let d = (dir || "/").replace(/\/+$/, "") || "/";
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

function readLines(path) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {}
  const out = [];
  for (const l of text.split("\n")) {
    try {
      if (l) out.push(JSON.parse(l));
    } catch {}
  }
  return out;
}

function record(input) {
  const session = input.session_id;
  const transcript = input.transcript_path;
  if (!session) throw new Error("no session_id in the hook input");
  if (!transcript) throw new Error("no transcript_path in the hook input");
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || input.cwd);
  if (!existsSync(join(root, "ai", "kit"))) return;
  const conf = readConfig(root).usage ?? {};
  if (conf.enabled === false) return;
  if (!statSync(transcript, { throwIfNoEntry: false })?.isFile()) throw new Error(`cannot read transcript ${transcript}`);

  const gitDir = git(root, "rev-parse", "--absolute-git-dir");
  const common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!gitDir || !common) throw new Error("not a git repository, usage not recorded");
  const cachePath = join(gitDir, "claude-usage", `${session}.json`);
  const cache = loadCache(cachePath);
  const sess = collectSession(transcript, cache);
  saveCache(cachePath, cache);

  const bufDir = join(common, "claude-usage");
  seedBuffer(root, bufDir, session);
  const buffer = join(bufDir, `${session}.jsonl`);
  const prior = readLines(buffer);
  const kit = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json"), "utf8")).version;
  const rec = buildRecord(sess, prior, {
    now: new Date(),
    session,
    kit,
    project: basename(root),
    user: git(root, "config", "user.name"),
    branch: git(root, "rev-parse", "--abbrev-ref", "HEAD"),
  });
  if (!rec) return;
  mkdirSync(bufDir, { recursive: true });
  appendFileSync(buffer, `${JSON.stringify(rec)}\n`);
  const prices = { ...DEFAULT_PRICES, ...(conf.prices ?? {}) };
  process.stdout.write(`${JSON.stringify({ systemMessage: summaryLine(rec, [...prior, rec], prices) })}\n`);
}

// flush --session <id> | flush --idle [--except <id>]: moves buffered records into ai/usage/ (never modifies a file there).
function flushCmd(args) {
  const root = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!existsSync(join(root, "ai", "kit")) || readConfig(root).usage?.enabled === false) return;
  const common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!common) return;
  const bufDir = join(common, "claude-usage");
  const val = (flag) => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? "") : "");
  if (args[0] === "--session" && val("--session")) flushSession(root, bufDir, val("--session"));
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
      process.stderr.write(`usage-log: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
    }
    return;
  }
  if (cmd === "flush") {
    try {
      flushCmd(process.argv.slice(3));
    } catch (e) {
      process.stderr.write(`usage-flush: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
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
  process.stderr.write("usage: usage.mjs record | flush --session <id> | flush --idle | digest [--since YYYY-MM-DD] [--baseline]\n");
  process.exitCode = 2;
}

main();
