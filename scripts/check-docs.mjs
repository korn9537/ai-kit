// Reports added doc lines breaking docs/ai-docs.md: emoji, bold, filler, dates, Thai; skips and exemptions there.
// Usage, cwd in the repo: node <plugin>/scripts/check-docs.mjs [--staged] [--strict: exit 1 on an issue] [files...]
// --wrap [--staged]: instead, the kit clone's check: added prose lines over 120 characters in *.md and *.sh (tables,
// frontmatter and shell code skipped), exit 1 on a hit; run by .githooks/pre-commit.
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
if (staged && !flag("wrap") && ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"].some((h) => git("rev-parse", "-q", "--verify", h)))
  process.exit(0);
const cwd = process.cwd();
process.chdir(root);
// scope: docs.include/skip in the repo's ai/kit/config.json; include "^$" turns the check off
const conf = existsSync("ai/kit/config.json")
  ? (JSON.parse(readFileSync("ai/kit/config.json", "utf8")).docs ?? {})
  : {};
const INCLUDE = new RegExp(conf.include ?? "^ai/.*\\.md$");
const SKIP = new RegExp(conf.skip ?? "(^|/)README\\.md$|/(mockups|design)/");

const MONTH =
  "(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sep(t(ember)?)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)\\.?";
const THAI = "thai outside quotes";
// `file.ext:N` with a code extension (code edits shift it); a host whose TLD is one (`x.rs:443`) is reported too
const LINE = "line pointer";
const CODE_EXT =
  "tsx?|jsx?|mjs|cjs|vue|svelte|dart|go|cs|java|kt|swift|py|rb|php|rs|c|cpp|h|sql|prisma|sh|css|scss|html|ya?ml|json";
const RULES = [
  ["emoji", /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u],
  ["bold", /(^|[^\w*])\*\*[^*\s]([^*]*[^*\s])?\*\*/],
  [
    "filler",
    /(?<![/\w])(etc\.|and so on|please note|it is important|basically|in order to|this (document|section|file) (describes|explains)|(about|around|roughly|approximately)(?=\s+(every\s+)?(~?(?!(19|20)\d\d\b)\d|(a\s+)?(dozen|hundred|thousand)(?![-\w])))|~(?=\d))/i,
  ],
  [
    "dated",
    new RegExp(
      `\\b20\\d\\d-\\d\\d-\\d\\d\\b|\\b\\d{1,2} ${MONTH} 20\\d\\d\\b|\\b${MONTH} \\d{1,2},? 20\\d\\d\\b`,
      "i",
    ),
  ],
  [THAI, /[฀-๿]/],
  [LINE, new RegExp(`(?<![\\w/.:@-])(?:[\\w.-]+/)*[\\w-]+(?:\\.[\\w-]+)*\\.(${CODE_EXT}):\\d+(?:-\\d+)?(?!\\w)`)],
].map(([name, re]) => {
  // re.test on a g or y regex keeps lastIndex between lines
  const one = new RegExp(re.source, re.flags.replace(/[gy]/g, ""));
  return [name, one, name === THAI ? /[฀-๿]+/g : new RegExp(one.source, one.flags + "g")];
});
const noCode = (l) => l.replace(/`[^`]*`/g, "");
const noQuotes = (l) =>
  l.replace(/"[^"]*"/g, '""').replace(/“[^”]*”/g, '""');
// a line pointer is written in a code span, so that rule reads the raw line
const prep = (name, l) =>
  name === LINE ? l : name === THAI || name === "dated" ? noQuotes(noCode(l)) : noCode(l);
// fragment -> count of what a rule matches on a line: bold without its boundary char, Thai as maximal runs
const counts = (name, all, t) => {
  const c = new Map();
  for (const m of t.matchAll(all)) {
    const g = name === "bold" ? m[0].slice(m[1].length) : m[0];
    c.set(g, (c.get(g) ?? 0) + 1);
  }
  return c;
};
// the closing line index of a leading frontmatter block, -1 when there is none: a `---` rule opening a doc with a
// later `---` is no frontmatter unless the first non-blank line is a key and every line between reads as YAML (a key,
// quoted or of at most three words; an indented, list or comment line; a line inside an open [ ] / { } flow
// collection), with every flow collection closed. Not a YAML parser; its limits: the line after the opening `---`
// must not be blank, and a block of one key whose value holds `<` (`Note: <200 chars>`) is prose unless a second key joins.
const KEY = /^("[^"]+"|'[^']+'|[A-Za-z_][\w -]*?)\s*:(\s|$)/;
const isKey = (l) => {
  const m = KEY.exec(l);
  return !!m && (/^["']/.test(m[1]) || m[1].trim().split(/\s+/).length <= 3);
};
const frontEnd = (ls) => {
  if (ls[0] !== "---") return -1;
  const end = ls.findIndex((l, i) => i > 0 && (l === "---" || l === "..."));
  if (end < 0) return -1;
  const body = ls.slice(1, end);
  if (body.length && !body[0].trim()) return -1;
  const first = body.find((l) => l.trim());
  if (first !== undefined && !isKey(first)) return -1;
  let depth = 0;
  let keys = 0;
  for (const l of body) {
    const inFlow = depth > 0;
    if (!inFlow && l.trim() && !/^(\s|-\s|#)/.test(l)) {
      if (!isKey(l)) return -1;
      keys++;
      if (keys === 1 && body.length === 1 && l.includes("<")) return -1;
    }
    for (const c of l.replace(/"[^"]*"|'[^']*'/g, "")) depth = Math.max(0, depth + (c === "[" || c === "{") - (c === "]" || c === "}"));
  }
  if (depth > 0 || (keys === 0 && first !== undefined)) return -1;
  return end;
};
// a fence marker line: ``` or ~~~ (3 or more), a backtick fence's info string holding no backtick (```x``` is inline)
const fenceOf = (l) => {
  const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(l);
  return m && !(m[1][0] === "`" && m[2].includes("`")) ? { mark: m[1], rest: m[2].trim() } : null;
};
// line number -> text of the lines the rules see: outside frontmatter and fenced blocks
const scan = (text) => {
  const ls = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const out = new Map();
  const end = frontEnd(ls);
  let fence = null;
  for (let i = end + 1; i < ls.length; i++) {
    const l = ls[i];
    const f = fenceOf(l);
    if (fence) {
      if (f && f.mark[0] === fence[0] && f.mark.length >= fence.length && !f.rest) fence = null;
    } else if (f) fence = f.mark;
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
// no HEAD yet (unborn branch): diff against the empty tree
const EMPTY_TREE = () => git("hash-object", "-t", "tree", "/dev/null")?.trim();
const range = staged ? ["--cached"] : [git("rev-parse", "-q", "--verify", "HEAD") !== null ? "HEAD" : EMPTY_TREE()];
const added = new Map();
const diffs = [];
const byNew = new Map();
let cur = null;
let hunk = null;
let oldNo = 0;
let header = false;
const diffText = git("diff", "-U0", "-M", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", ...range);
if (diffText === null) {
  console.log("docs: git diff failed, the added lines are not known");
  process.exit(flag("strict") || flag("wrap") ? 1 : 0);
}
for (const l of diffText.split("\n")) {
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
    hunk = { removed: [], adds: [], start, end: start + (len || 1), delta: len - Number(m[2] ?? 1), counts: new Map() };
    cur.hunks.push(hunk);
    oldNo = Number(m[1]);
    for (let i = 0; i < len; i++) added.get(cur.new)?.set(start + i, hunk);
  } else if (!header && hunk && l.startsWith("-")) hunk.removed.push([oldNo++, l.slice(1)]);
  else if (!header && hunk && l.startsWith("+")) hunk.adds.push([hunk.start + hunk.adds.length, l.slice(1)]);
}
const WRAP = 120;
if (flag("wrap")) {
  const hits = [];
  for (const d of diffs) {
    const f = d.new;
    if (!f || !/\.(md|sh)$/.test(f)) continue;
    const sh = f.endsWith(".sh");
    // a shell file's code lines hold regexes and strings that cannot wrap; its comments can
    const long = d.hunks
      .flatMap((h) => h.adds)
      .filter(([, t]) => [...t].length > WRAP && (sh ? /^\s*#/.test(t) : !/^\s*\|/.test(t)));
    if (!long.length) continue;
    const text = sh ? "" : ((staged ? git("show", `:./${f}`) : existsSync(f) ? readFileSync(f, "utf8") : "") ?? "");
    const front = frontEnd(text.replace(/^\uFEFF/, "").split(/\r?\n/)) + 1;
    for (const [n, t] of long) if (n > front) hits.push(`${f}:${n}: ${[...t].length} chars`);
  }
  if (hits.length) console.log(`lines over ${WRAP} characters (rewrap):\n${hits.join("\n")}`);
  process.exit(hits.length ? 1 : 0);
}
// keep only removed lines the rules saw in HEAD; their text marks a moved line
// an old path out of scope saw nothing: no removed line excuses a hit, every line counts as added
// ai/kit/conventions/ is a generated copy of the kit's conventions, outside any repo's docs.skip
const inScope = (f) => INCLUDE.test(f) && !SKIP.test(f) && !f.startsWith("ai/kit/conventions/");
// HEAD text of each path, one git process for all; a missing blob reads as ""
const heads = (paths) => {
  const out = new Map();
  if (!paths.length) return out;
  let buf;
  try {
    buf = execFileSync("git", ["cat-file", "--batch"], {
      input: paths.map((p) => `HEAD:${p}\n`).join(""),
      stdio: ["pipe", "pipe", "ignore"],
      maxBuffer: 1 << 28,
    });
  } catch {
    return out;
  }
  let at = 0;
  for (const p of paths) {
    const nl = buf.indexOf(10, at);
    const hdr = buf.toString("utf8", at, nl);
    at = nl + 1;
    // "<oid> <type> <size>" is followed by content; "missing" or a gitlink line is not
    const m = /^\S+ (\S+) (\d+)$/.exec(hdr);
    if (!m) continue;
    const size = Number(m[2]);
    if (m[1] === "blob") out.set(p, buf.toString("utf8", at, at + size));
    at += size + 1;
  }
  return out;
};
const headText = heads([...new Set(diffs.filter((d) => d.old && inScope(d.old)).map((d) => d.old))]);
// text -> how many removed lines hold it; each moved line uses one up
const removed = new Map();
for (const d of diffs) {
  const seen = !d.old ? null : inScope(d.old) ? scan(headText.get(d.old) ?? "") : new Map();
  d.seen = seen;
  d.own = new Map();
  for (const h of d.hunks) {
    if (seen) h.removed = h.removed.filter(([n]) => seen.has(n));
    for (const [, r] of h.removed) {
      removed.set(r.trim(), (removed.get(r.trim()) ?? 0) + 1);
      d.own.set(r.trim(), (d.own.get(r.trim()) ?? 0) + 1);
    }
  }
}
// uses one count of a removed line's text from `from`, and from the global count too
const take = (from, l) => {
  const t = l.trim();
  const n = from?.get(t);
  if (!t || !n) return false;
  from.set(t, n - 1);
  if (from !== removed) removed.set(t, removed.get(t) - 1);
  return true;
};
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
    ? z(git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "--ignore-submodules=all", "-z"))
    : [
        ...z(git("diff", "HEAD", "--name-only", "--diff-filter=ACMR", "-z")),
        ...z(git("ls-files", "--others", "--exclude-standard", "-z")),
      ];
files = files.filter((f) => inScope(f) && (staged || existsSync(f)));

const issues = [];
const todo = [];
for (const f of files) {
  const text = staged ? git("show", `:./${f}`) : readFileSync(f, "utf8");
  if (text === null) {
    if (flag("strict")) {
      console.log(`docs: cannot read ${f} from the index`);
      process.exit(1);
    }
    continue;
  }
  // untracked, or no HEAD yet: every line is new
  const want = added.get(f) ?? (staged || (head && tracked.has(f)) ? new Set() : null);
  // an unchanged line the rules did not see in HEAD (it left a fence or frontmatter) counts as added
  const d = byNew.get(f);
  let k = 0;
  let delta = 0;
  for (const [n, l] of scan(text)) {
    for (; d?.seen && k < d.hunks.length && d.hunks[k].end <= n; k++) delta += d.hunks[k].delta;
    const left = d?.seen && !d.seen.has(n - delta);
    if (!want || want.has(n) || left) todo.push({ f, n, l, d });
  }
}
// a moved line takes a removed copy of its own file first, so a copy elsewhere cannot take it
for (const x of todo) x.moved = take(x.d?.own, x.l);
for (const { f, n, l, moved } of todo) {
  if (moved || take(removed, l)) continue;
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

issues.forEach((x) => console.log(x));
if (issues.length) {
  console.log(
    `\ndocs: ${issues.length} issue(s) — rule: ${join(import.meta.dirname, "..", "docs", "ai-docs.md")}`,
  );
  if (flag("strict")) process.exit(1);
}
