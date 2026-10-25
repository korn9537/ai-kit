#!/usr/bin/env node
// Token usage CLI. `record` is the Stop hook: reads the hook JSON on stdin, appends this round's delta record to
// <root>/ai/usage/<YYYY-MM>/<session>.jsonl and prints the one-line summary. It never fails a stop: exit 0 always.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectSession, loadCache, saveCache } from "./usage-collect.mjs";
import { baselineRecords, digest, loadRecords } from "./usage-digest.mjs";
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

// An existing file of the session under any month folder, so a session never splits across months.
function sessionFile(usageDir, session, firstTs) {
  let months = [];
  try {
    months = readdirSync(usageDir).sort();
  } catch {}
  for (const m of months) {
    const p = join(usageDir, m, `${session}.jsonl`);
    if (existsSync(p)) return p;
  }
  const month = /^\d{4}-\d{2}/.test(firstTs) ? firstTs.slice(0, 7) : new Date().toISOString().slice(0, 7);
  return join(usageDir, month, `${session}.jsonl`);
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
  const cachePath = gitDir ? join(gitDir, "claude-usage", `${session}.json`) : "";
  const cache = cachePath ? loadCache(cachePath) : undefined;
  const sess = collectSession(transcript, cache);
  if (cachePath) saveCache(cachePath, cache);

  const usageDir = join(root, "ai", "usage");
  const file = sessionFile(usageDir, session, sess.firstTs);
  const prior = readLines(file);
  const kit = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json"), "utf8")).version;
  const rec = buildRecord(sess, prior, {
    now: new Date(),
    session,
    kit,
    project: basename(root),
    user: git(root, "config", "user.name"),
    branch: git(root, "rev-parse", "--abbrev-ref", "HEAD"),
    prompts: conf.prompts === "none" ? "none" : "full",
  });
  if (!rec) return;
  const firstInRepo = !existsSync(usageDir);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(rec)}\n`);
  const prices = { ...DEFAULT_PRICES, ...(conf.prices ?? {}) };
  process.stdout.write(`${JSON.stringify({ systemMessage: summaryLine(rec, [...prior, rec], prices, firstInRepo) })}\n`);
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
    process.stdout.write(`${digest(recs, prices, { bad, skipped })}\n`);
    return;
  }
  const who = { project: basename(root), user: git(root, "config", "user.name") };
  const { recs, skipped } = baselineRecords(root, who, since);
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
  if (cmd === "digest") {
    try {
      digestCmd(process.argv.slice(3));
    } catch (e) {
      process.stderr.write(`usage-digest: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
      process.exitCode = 2;
    }
    return;
  }
  process.stderr.write("usage: usage.mjs record | digest [--since YYYY-MM-DD] [--baseline]\n");
  process.exitCode = 2;
}

main();
