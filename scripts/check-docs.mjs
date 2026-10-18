// Reports added doc lines breaking docs/ai-docs.md: emoji, bold, filler, dates, Thai; skips and exemptions there.
// Usage, cwd in the repo: node <plugin>/scripts/check-docs.mjs [--staged] [--strict: exit 1 on an issue] [files...]
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
    /(?<![/\w])(etc\.|and so on|please note|it is important|basically|in order to|this (document|section|file) (describes|explains)|(about|around|roughly|approximately) (every )?~?\d)/i,
  ],
  [
    "dated",
    new RegExp(
      `\\b20\\d\\d-\\d\\d-\\d\\d\\b|\\b\\d{1,2} ${MONTH} 20\\d\\d\\b|\\b${MONTH} \\d{1,2},? 20\\d\\d\\b`,
      "i",
    ),
  ],
  [THAI, /[฀-๿]/],
].map(([name, re]) => {
  // re.test on a g or y regex keeps lastIndex between lines
  const one = new RegExp(re.source, re.flags.replace(/[gy]/g, ""));
  return [name, one, name === THAI ? /[฀-๿]+/g : new RegExp(one.source, one.flags + "g")];
});
const noCode = (l) => l.replace(/`[^`]*`/g, "");
const noQuotes = (l) =>
  l.replace(/"[^"]*"/g, '""').replace(/“[^”]*”/g, '""');
const prep = (name, l) => (name === THAI || name === "dated" ? noQuotes(noCode(l)) : noCode(l));
// fragment -> count of what a rule matches on a line: bold without its boundary char, Thai as maximal runs
const counts = (name, all, t) => {
  const c = new Map();
  for (const m of t.matchAll(all)) {
    const g = name === "bold" ? m[0].slice(m[1].length) : m[0];
    c.set(g, (c.get(g) ?? 0) + 1);
  }
  return c;
};
// line number -> text of the lines the rules see: outside frontmatter and fenced blocks
const scan = (text) => {
  const ls = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const out = new Map();
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
    } else if (open) fence = open;
    else out.set(i + 1, l);
  }
  return out;
};

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
// per file: new line number -> its hunk, and the HEAD path (renames paired with -M); a hunk holds its removed lines
const range = staged ? ["--cached"] : ["HEAD"];
const added = new Map();
const diffs = [];
const byNew = new Map();
let cur = null;
let hunk = null;
let oldNo = 0;
let header = false;
for (const l of (
  git("diff", "-U0", "-M", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", ...range) ?? ""
).split("\n")) {
  if (l.startsWith("diff --git ")) {
    header = true;
    cur = { old: null, hunks: [] };
    diffs.push(cur);
    hunk = null;
    continue;
  }
  if (header && (l.startsWith("--- ") || l.startsWith("+++ "))) {
    const p = unquote(l.slice(4).replace(/\t$/, ""));
    const path = p === "/dev/null" ? null : p.slice(2);
    if (l[0] === "-") cur.old = path;
    else if (path) {
      added.set(path, new Map());
      byNew.set(path, cur);
    }
    cur.new = path;
    continue;
  }
  // a 100% rename has no ---/+++ lines or hunks
  const rn = header && /^rename (from|to) (.*)$/.exec(l);
  if (rn) {
    const path = unquote(rn[2]);
    if (rn[1] === "from") cur.old = path;
    else {
      cur.new = path;
      if (!added.has(path)) added.set(path, new Map());
      byNew.set(path, cur);
    }
    continue;
  }
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
  if (m && cur) {
    header = false;
    const [start, len] = [Number(m[3]), Number(m[4] ?? 1)];
    // end: first new line after the hunk; delta: new minus old line count
    hunk = { removed: [], start, end: start + (len || 1), delta: len - Number(m[2] ?? 1), counts: new Map() };
    cur.hunks.push(hunk);
    oldNo = Number(m[1]);
    for (let i = 0; i < len; i++) added.get(cur.new)?.set(start + i, hunk);
  } else if (!header && hunk && l.startsWith("-")) hunk.removed.push([oldNo++, l.slice(1)]);
}
// keep only removed lines the rules saw in HEAD; their text marks a moved line
// an old path out of scope saw nothing: no removed line excuses a hit, every line counts as added
const inScope = (f) => INCLUDE.test(f) && !SKIP.test(f);
const removed = new Set();
for (const d of diffs) {
  const seen = !d.old ? null : inScope(d.old) ? scan(git("show", `HEAD:${d.old}`) ?? "") : new Map();
  d.seen = seen;
  for (const h of d.hunks) {
    if (seen) h.removed = h.removed.filter(([n]) => seen.has(n));
    for (const [, r] of h.removed) removed.add(r.trim());
  }
}
// fragment counts of each removed line of a hunk, once per rule; a removed table row holds no Thai
const oldCounts = (h, name, all) => {
  if (!h.counts.has(name)) {
    const cs = h.removed.map(([, r]) => (name === THAI && /^\s*\|/.test(r) ? new Map() : counts(name, all, prep(name, r))));
    const by = new Map();
    cs.forEach((c, k) => c.forEach((_, g) => (by.get(g) ?? by.set(g, []).get(g)).push(k)));
    h.counts.set(name, { cs, by });
  }
  return h.counts.get(name);
};
const covers = (o, got) => [...got].every(([g, n]) => (o.get(g) ?? 0) >= n);
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
files = files.filter((f) => inScope(f) && existsSync(f));

const issues = [];
for (const f of files) {
  const text = staged ? git("show", `:${f}`) : readFileSync(f, "utf8");
  if (text === null) continue;
  // untracked, or no HEAD yet: every line is new
  const want = added.get(f) ?? (staged || (head && tracked.has(f)) ? new Set() : null);
  // an unchanged line the rules did not see in HEAD (it left a fence or frontmatter) counts as added
  const d = byNew.get(f);
  let k = 0;
  let delta = 0;
  for (const [n, l] of scan(text)) {
    for (; d?.seen && k < d.hunks.length && d.hunks[k].end <= n; k++) delta += d.hunks[k].delta;
    const left = d?.seen && !d.seen.has(n - delta);
    if ((want && !want.has(n) && !left) || (l.trim() && removed.has(l.trim()))) continue;
    const row = /^\s*\|/.test(l);
    const h = added.get(f)?.get(n);
    for (const [name, re, all] of RULES) {
      if (name === THAI && row) continue;
      const t = prep(name, l);
      if (!re.test(t)) continue;
      // an edited line keeps its old hits: skip when one removed line of its hunk held as many of each fragment
      if (h) {
        const got = counts(name, all, t);
        const { cs, by } = oldCounts(h, name, all);
        // candidates: removed lines holding the added line's rarest fragment
        let best = null;
        for (const g of got.keys()) {
          const ks = by.get(g) ?? [];
          if (!best || ks.length < best.length) best = ks;
          if (!ks.length) break;
        }
        if ((best ?? []).some((k) => covers(cs[k], got))) continue;
      }
      issues.push(`${f}:${n} ${name}: ${l.trim().slice(0, 80)}`);
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
