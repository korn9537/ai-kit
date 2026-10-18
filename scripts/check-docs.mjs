// Reports added doc lines breaking docs/ai-docs.md: emoji, bold, fixed filler list, dates, Thai outside quotes or code.
// Usage, cwd in the repo: node <plugin>/scripts/check-docs.mjs [--staged] [--strict: exit 1 on an issue] [files...]
// Skips fenced blocks, frontmatter, code spans, moved lines, hits already on a removed line of the same file; double/
// curly quotes and table rows exempt Thai (quotes: dates too). Indented code is not skipped.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const staged = flag("staged");
const git = (...a) => {
  try {
    return execFileSync("git", ["-c", "core.quotePath=false", ...a], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1 << 28,
    });
  } catch {
    return null;
  }
};
const root = git("rev-parse", "--show-toplevel")?.trim();
if (!root) {
  console.log("docs: not in a git repo");
  process.exit(flag("strict") ? 1 : 0);
}
// a merge, cherry-pick or revert brings in lines the committer did not write
if (staged && ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"].some((h) => git("rev-parse", "-q", "--verify", h)))
  process.exit(0);
const cwd = process.cwd();
process.chdir(root);
// scope: docs.include/skip in the repo's ai/kit/config.json; include "^$" turns the check off
const conf = existsSync("ai/kit/config.json")
  ? (JSON.parse(readFileSync("ai/kit/config.json", "utf8")).docs ?? {})
  : {};
const INCLUDE = new RegExp(conf.include ?? "^(CLAUDE\\.md|(docs|ai)/.*\\.md)$");
const SKIP = new RegExp(conf.skip ?? "(^|/)README\\.md$|/(mockups|design)/");

const MONTH =
  "(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sep(t(ember)?)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)\\.?";
const THAI = "thai outside quotes";
const RULES = [
  ["emoji", /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u],
  ["bold", /(^|[^\w*])\*\*[^*\s]([^*]*[^*\s])?\*\*/],
  [
    "filler",
    /(?<![/\w])(etc\.|and so on|please note|it is important|basically|in order to|this (document|section|file) (describes|explains))/i,
  ],
  [
    "dated",
    new RegExp(
      `\\b20\\d\\d-\\d\\d-\\d\\d\\b|\\b\\d{1,2} ${MONTH} 20\\d\\d\\b|\\b${MONTH} \\d{1,2},? 20\\d\\d\\b`,
      "i",
    ),
  ],
  [THAI, /[฀-๿]/],
];
const noCode = (l) => l.replace(/`[^`]*`/g, "");
const noQuotes = (l) =>
  l.replace(/"[^"]*"/g, '""').replace(/“[^”]*”/g, '""');
const prep = (name, l) => (name === THAI || name === "dated" ? noQuotes(noCode(l)) : noCode(l));
// what a rule matches on a line: bold without its boundary char, Thai as maximal runs
const frags = (name, re, t) =>
  [...t.matchAll(name === THAI ? /[฀-๿]+/g : new RegExp(re.source, re.flags + "g"))].map((m) =>
    name === "bold" ? m[0].slice(m[1].length) : m[0],
  );

// git still C-quotes a path holding `"`, `\` or a control character; a newline in a name stays unmatched
const ESC = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
const unquote = (s) =>
  s.startsWith('"')
    ? s
        .slice(1, -1)
        .replace(/\\([0-7]{3}|.)/g, (_, e) =>
          e.length === 3 ? String.fromCharCode(parseInt(e, 8)) : (ESC[e] ?? e),
        )
    : s;
// added line numbers per file from one diff (renames paired with -M); a removed line's text marks a move
const range = staged ? ["--cached"] : ["HEAD"];
const added = new Map();
const removed = new Set();
const removedIn = new Map(); // file -> its removed lines
let cur = null;
let header = false;
for (const l of (
  git("diff", "-U0", "-M", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", ...range) ?? ""
).split("\n")) {
  if (l.startsWith("diff --git ")) {
    header = true;
    cur = null;
    continue;
  }
  if (header && l.startsWith("+++ ")) {
    const p = unquote(l.slice(4).replace(/\t$/, ""));
    cur = p === "/dev/null" ? null : p.slice(2);
    if (cur) {
      added.set(cur, new Set());
      removedIn.set(cur, []);
    }
    continue;
  }
  const m = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(l);
  if (m) {
    header = false;
    if (cur) for (let i = 0; i < Number(m[2] ?? 1); i++) added.get(cur).add(Number(m[1]) + i);
  } else if (!header && l.startsWith("-")) {
    removed.add(l.slice(1).trim());
    if (cur) removedIn.get(cur).push(l.slice(1));
  }
}
const tracked = new Set((git("ls-files", "-z") ?? "").split("\0"));
const head = git("rev-parse", "-q", "--verify", "HEAD") !== null;

const z = (s) => (s ?? "").split("\0").filter(Boolean);
let files = args
  .filter((a) => !a.startsWith("--"))
  .map((f) => relative(root, resolve(cwd, f)));
if (!files.length)
  files = staged
    ? z(git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"))
    : [
        ...z(git("diff", "HEAD", "--name-only", "--diff-filter=ACMR", "-z")),
        ...z(git("ls-files", "--others", "--exclude-standard", "-z")),
      ];
files = files.filter((f) => INCLUDE.test(f) && !SKIP.test(f) && existsSync(f));

const issues = [];
for (const f of files) {
  const text = staged ? git("show", `:${f}`) : readFileSync(f, "utf8");
  if (text === null) continue;
  // untracked, or no HEAD yet: every line is new
  const want = added.get(f) ?? (staged || (head && tracked.has(f)) ? new Set() : null);
  const ls = text.replace(/^﻿/, "").split(/\r?\n/);
  let from = 0;
  if (ls[0] === "---") {
    const end = ls.findIndex((l, i) => i > 0 && (l === "---" || l === "..."));
    if (end > 0) from = end + 1;
  }
  let fence = null;
  for (let i = from; i < ls.length; i++) {
    const l = ls[i];
    const open = /^\s*(`{3,}|~{3,})/.exec(l)?.[1];
    if (fence) {
      if (open && open[0] === fence[0] && open.length >= fence.length && !l.trim().slice(open.length))
        fence = null;
      continue;
    }
    if (open) {
      fence = open;
      continue;
    }
    if ((want && !want.has(i + 1)) || (l.trim() && removed.has(l.trim()))) continue;
    const row = /^\s*\|/.test(l);
    for (const [name, re] of RULES) {
      if (name === THAI && row) continue;
      const t = prep(name, l);
      if (!re.test(t)) continue;
      // an edited line keeps its old hits: skip when one removed line already had every fragment
      const got = frags(name, re, t);
      const old = (removedIn.get(f) ?? []).map((r) => new Set(frags(name, re, prep(name, r))));
      if (old.some((o) => got.every((g) => o.has(g)))) continue;
      issues.push(`${f}:${i + 1} ${name}: ${l.trim().slice(0, 80)}`);
    }
  }
}

issues.forEach((x) => console.log(x));
if (issues.length) {
  console.log(
    `\ndocs: ${issues.length} issue(s) — rule: ${join(import.meta.dirname, "..", "docs", "ai-docs.md")}`,
  );
  if (flag("strict")) process.exit(1);
}
