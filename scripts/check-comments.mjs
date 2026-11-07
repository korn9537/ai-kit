// Reports comments breaking docs/code-comments.md: blocks over 2 lines, history, dates, two C# <summary>s on a member.
// Usage, cwd in the repo: node <plugin>/scripts/check-comments.mjs [--staged] [--strict: exit 1 on an issue] [files...]
// --size: instead, block a staged edit to a code file over 40 KB at HEAD unless it only moves lines out (general.md
// item 12); escape ALLOW_LARGE_EDIT=1.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const MAX_BLOCK = 2;
const git = (...a) =>
  execFileSync("git", a, { encoding: "utf8" }).split("\n").filter(Boolean);
// NUL-separated path lists: git C-quotes a name with `"`, `\` or non-ASCII otherwise
const gitz = (...a) =>
  execFileSync("git", [...a, "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const gitText = (...a) => {
  try {
    return execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 });
  } catch {
    return null;
  }
};
const root = git("rev-parse", "--show-toplevel")[0];
const cwd = process.cwd();
process.chdir(root);
// the size escape needs no config, so a bad comments.include does not stop it
if (flag("size") && process.env.ALLOW_LARGE_EDIT === "1") process.exit(0);
// scope: comments.include/skip in the repo's ai/kit/config.json
const conf = existsSync("ai/kit/config.json")
  ? (JSON.parse(readFileSync("ai/kit/config.json", "utf8")).comments ?? {})
  : {};
const rx = (key, def) => {
  try {
    return new RegExp(conf[key] ?? def);
  } catch (e) {
    console.log(`comments: ai/kit/config.json comments.${key} is not a valid regex: ${e.message}`);
    process.exit(1);
  }
};
const INCLUDE = rx("include", "\\.(tsx?|jsx?|mjs|cs)$");
const SKIP = rx("skip", "(/generated/|/node_modules/|\\.d\\.ts$|\\.Designer\\.cs$)");
// the past-tense phrase is history, unless is/are/be/gets (with at most one adverb) leads it, or a verb of what code
// does follows it
const PRESENT_USE = "build|compute|derive|generate|identify|determine|decide|select|match|check|verify|validate|hash|encode|decode|parse|format|sort|find|resolve|sign|locate|authenticate";
const HISTORY = new RegExp(
  [
    `(?<!\\b(is|are|be|being|been|gets?)( \\w+ly)? )\\bused to\\b(?! (${PRESENT_USE})\\b)`,
    "(?<!\\b(the|an?|any) )\\bpreviously\\b",
    "\\b(the|an?|any) previously (?!(computed|cached|seen|stored|fetched|selected|focused|saved|loaded)\\b)",
    "\\buntil (v?\\d+\\.\\d+|20\\d\\d)\\b(?! ?(ms|s|sec|secs|seconds?|minutes?|min|h|hours?|days?|bytes?|[kmg]i?b)\\b)",
    "\\bwas once\\b|\\bno longer(?! than)\\b|\\bformerly\\b",
    "(?<!ไม่)เคย|ก่อนหน้านี้|(เดิม|แต่ก่อน|ก่อนนี้).*ไม่เคย",
  ].join("|"),
  "i",
);
// History by date or by who asked (git log has both); tests skip it — a fixture date is data, not history.
const MONTH =
  "(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sep(t(ember)?)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)\\.?";
const TH_MONTH =
  "(ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.)";
const DATED = new RegExp(
  [
    `\\b\\d{1,2} ${MONTH} 20\\d\\d\\b`,
    `\\b${MONTH} \\d{1,2},? 20\\d\\d\\b`,
    "\\b20\\d\\d-\\d\\d-\\d\\d\\b",
    `\\d{1,2} ${TH_MONTH} ?((20|25)\\d\\d|\\d\\d\\b)`,
    "\\bowner[- ](approved|requested|asked)\\b",
    "เจ้าของงาน(สั่ง|ขอ)|ตามที่ผู้ใช้(สั่ง|ขอ)",
  ].join("|"),
  "i",
);
const TESTS = /(\/tests?\/|\/e2e\/|\.(test|spec)\.tsx?$|_test\.(go|dart|py)$|(^|\/)test_[^/]*\.py$)/;
// a `*` line is a comment only inside /* */: outside it is code (`*args,` in a call split over lines)
const COMMENT = /^\s*(\/\/|\/\*|\{\/\*)/;
const BLOCK_OPEN = /^\s*\{?\/\*/;
// `#` comments; in Python a triple-quoted string first in the file or right after a def/class line is one too
// (a docstring); lines inside a shell heredoc or another triple-quoted string are data
const HASH = /\.(py|sh|bash|rb|ya?ml)$/;
const HASH_KEEP =
  /^\s*#(!|\s*(-\*-|noqa\b|type:|pylint:|shellcheck |rubocop:|frozen_string_literal|fmt:|pragma\b|yaml-language-server))/;
const DOC_OPEN = /^\s*[rRuUbB]{0,2}("""|''')/;
const DOC_AFTER = /^(async\s+)?(def|class)\b.*:$|\)(\s*->.*)?:$/;
// not a here-string (<<<) or a shift (inside `(( ))`, or a `let` line)
const HEREDOC = /(?<!<)<<(?![<(\d])-?\s*['"]?([A-Za-z_]\w*)['"]?/;
// whether a template literal is open at the end of a code line: backticks inside strings, regexes and a trailing
// `//` comment do not count
const RE_AFTER = "(,=:[!&|?{};+-*%<>~^";
// A JSX text apostrophe (`<p>don't</p>`) opens a string no parser of ours can tell from a real one; in .tsx/.jsx a
// line that ends inside a string or regex is of unknown state, so it falls back to counting its backticks.
const inTemplate = (l, tpl, jsx = false) => {
  const start = tpl;
  let q = "";
  let cls = false;
  let prev = "";
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (c === "\\") i++;
    else if (tpl) tpl = c !== "`";
    else if (q) {
      if (q === "/" && c === "[") cls = true;
      else if (cls) cls = c !== "]";
      else if (c === q) q = "";
    } else if (c === "`") tpl = true;
    else if (c === '"' || c === "'") q = c;
    else if (c === "/" && l[i + 1] === "/") break;
    else if (c === "/" && l[i + 1] === "*") {
      const end = l.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
    } else if (c === "/" && l[i - 1] !== "<" && (!prev || RE_AFTER.includes(prev) || /\b(return|typeof|case)$/.test(l.slice(0, i).trimEnd()))) {
      q = "/";
    }
    // `++` / `--` end an operand, so a `/` after them divides
    if (!/\s/.test(c) && !q) prev = (c === "+" || c === "-") && l[i - 1] === c ? "x" : c;
  }
  if (jsx && q && !tpl) return (l.replace(/\\./g, "").split("`").length - 1) % 2 ? !start : start;
  return tpl;
};
const commentLines = (f, lines) => {
  const out = [];
  if (HASH.test(f)) {
    const py = f.endsWith(".py");
    const sh = /\.(sh|bash)$/.test(f);
    let doc = "";
    let data = "";
    let prev = "";
    for (const l of lines) {
      if (data) {
        out.push(false);
        if (sh ? l.trim() === data : l.includes(data)) data = "";
        continue;
      }
      const m = !doc && py && (prev === "" || DOC_AFTER.test(prev)) && DOC_OPEN.exec(l);
      const hash = /^\s*#/.test(l);
      if (doc || m) {
        out.push(true);
        const rest = m ? l.slice(m[0].length) : l;
        if (doc && rest.includes(doc)) doc = "";
        else if (m && !rest.includes(m[1])) doc = m[1];
      } else {
        out.push(hash);
        if (sh && !hash && !/^\s*let\b/.test(l))
          data = HEREDOC.exec(l.replace(/\$?\(\([^)]*\)\)/g, ""))?.[1] ?? "";
        if (py && !hash)
          data = ['"""', "'''"].find((q) => l.split(q).length % 2 === 0) ?? "";
      }
      if (l.trim() && !hash) prev = l.replace(/\s+#.*$/, "").trim();
    }
    return out;
  }
  // JS/TS: a line inside a template literal (odd backticks on code lines so far) is data, never a comment
  const js = /\.[cm]?[jt]sx?$/.test(f);
  const jsx = /\.[jt]sx$/.test(f);
  let tpl = false;
  let block = -1;
  lines.forEach((l, i) => {
    const open = block < 0 && !tpl && COMMENT.test(l);
    out.push(block >= 0 || open);
    if (open) block = BLOCK_OPEN.test(l) && !l.replace(BLOCK_OPEN, "").includes("*/") ? i : -1;
    else if (block >= 0 && l.includes("*/")) block = -1;
    else if (js && block < 0) tpl = inTemplate(l, tpl, jsx);
  });
  // never closed (a `/*` inside a string): only its opening line is a comment
  if (block >= 0) for (let i = block + 1; i < lines.length; i++) out[i] = COMMENT.test(lines[i]);
  return out;
};
const SUMMARY = /^\s*\/\/\/\s*<summary>/;
const KEEP =
  /eslint-disable|@ts-(expect-error|ignore)|#pragma|prettier-ignore|biome-ignore|^\s*\/\/(go:|nolint\b|line )/;
const DART_KEEP = /^\s*\/\/ ignore(_for_file)?:/;
// Go's generated-file marker, valid only in the header before the package clause (go.dev/s/generatedcode)
const GENERATED = /^\/\/ Code generated .* DO NOT EDIT\.$/;
const generatedGo = (f, lines, cl) => {
  if (!f.endsWith(".go")) return false;
  for (const [i, l] of lines.entries()) {
    if (GENERATED.test(l)) return true;
    if (l.trim() && !cl[i]) return false;
  }
  return false;
};

// --size: see the header
if (flag("size")) {
  const LIMIT = 40 * 1024;
  const gitRaw = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 30 });
  if (process.env.ALLOW_LARGE_EDIT === "1") process.exit(0);
  // a merge, cherry-pick or revert brings in lines the committer did not write
  const has = (h) => {
    try {
      return !!gitRaw("rev-parse", "-q", "--verify", h);
    } catch {
      return false;
    }
  };
  if (["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"].some(has)) process.exit(0);
  // a split adds the import of the new file to the old one; a multi-line import runs to its `} from`, `}` / `};` (a trailing `//` comment allowed) or `)` line
  const WIRING =
    /^(import\b|export\s*(\*|\{[^}]*\}|type\s*\{[^}]*\})\s*(as\s+\w+\s+)?from\b|export\s*(type\s*)?\{$|using\s+(static\s+)?[\w.]+\s*;$|using\s+(?!var\b)\w+\s*=\s*[\w.<>,\s]+;$|(const|let|var)\b.*=\s*require\(|from\s+\S+\s+import\b|require(_relative)?\s+['"])/;
  const OPEN = /^(import|export)\b[^;]*\{$|^from\s+\S+\s+import\s*\($/;
  const CLOSE = /^\}.*\bfrom\b|^\}\s*;?\s*(\/\/.*)?$|^\)$/;
  const PARTIAL = /^((?:[a-z]+\s+)*)partial\s+(?=(class|struct|interface|record)\b)/;

  // [path now, path at HEAD]: a rename (R) keeps the size of its old path. -M20% pairs a rewrite down to 20% alike;
  // one rewritten past that counts as a new file (D+A), which has no size at HEAD.
  const changed = [];
  const ns = gitRaw("diff", "--cached", "--name-status", "-M20%", "--diff-filter=MR", "-z").split("\0");
  for (let i = 0; i < ns.length - 1; ) {
    const two = ns[i].startsWith("R");
    changed.push([ns[i + (two ? 2 : 1)], ns[i + 1]]);
    i += two ? 3 : 2;
  }
  const big = changed
    .filter(([f]) => INCLUDE.test(f) && !SKIP.test(f))
    .map(([f, old]) => {
      try {
        return [f, Number(gitRaw("cat-file", "-s", `HEAD:${old}`).trim())];
      } catch {
        return [f, 0];
      }
    })
    .filter(([, size]) => size > LIMIT);
  if (!big.length) process.exit(0);

  // staged lines per file, leading whitespace dropped (a move may re-indent), null at each hunk; one diff per name
  const lines = (f) => {
    const out = { "+": [], "-": [] };
    let body = false;
    for (const l of gitRaw("diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--", `:(literal)${f}`).split("\n")) {
      if (l.startsWith("@@")) {
        body = true;
        out["+"].push(null);
      }
      else if (body && /^[+-]/.test(l) && l.slice(1).trim()) out[l[0]].push(l.slice(1).trim());
    }
    return out;
  };
  const staged = gitRaw("diff", "--cached", "--name-only", "--no-renames", "-z").split("\0").filter(Boolean);
  const diffs = new Map(staged.map((f) => [f, lines(f)]));

  const add = (bag, t) => bag.set(t, (bag.get(t) ?? 0) + 1);
  const pay = (bag, t) => !!bag.get(t) && !!bag.set(t, bag.get(t) - 1);

  // each removed line elsewhere pays for one added line (a multiset: `}` removed once covers one `}`); a C# split also
  // adds `partial` to the class line it keeps (csharp.md item 11), paid by that line removed from the same file
  const moveOnly = (f) => {
    const left = new Map();
    const own = new Map();
    for (const [g, d] of diffs)
      if (g !== f) for (const t of d["-"]) add(left, t);
    if (f.endsWith(".cs")) for (const t of diffs.get(f)["-"]) add(own, t);
    let open = false;
    for (const t of diffs.get(f)["+"]) {
      // an import whose `} from` line is context ends with its hunk
      if (t === null) {
        open = false;
        continue;
      }
      if (open || WIRING.test(t)) {
        open = open ? !CLOSE.test(t) : OPEN.test(t);
        continue;
      }
      const plain = t.replace(PARTIAL, "$1");
      if (!pay(left, t) && (plain === t || !pay(own, plain))) return false;
    }
    return true;
  };

  const bad = big.filter(([f]) => !moveOnly(f));
  for (const [f, size] of bad)
    console.log(
      `${f} is ${Math.round(size / 1024)} KB at HEAD: split it first in a move-only commit (general.md item 12)`,
    );
  if (bad.length) process.exit(1);
  process.exit(0);
}

let files = args
  .filter((a) => !a.startsWith("--"))
  .map((f) => relative(root, resolve(cwd, f)));
if (!files.length)
  files = flag("staged")
    ? gitz("diff", "--cached", "--name-only", "--diff-filter=ACMR", "--ignore-submodules=all")
    : gitz("ls-files");
// --staged reads the index, so a file deleted from the work tree is still checked
const staged = flag("staged");
files = files.filter((f) => INCLUDE.test(f) && !SKIP.test(f) && (staged || existsSync(f)));

const report = [];
for (const f of files) {
  const text = staged ? gitText("show", `:./${f}`) : readFileSync(f, "utf8");
  if (text === null) {
    if (flag("strict")) {
      console.log(`comments: cannot read ${f} from the index`);
      process.exit(1);
    }
    continue;
  }
  const lines = text.split(/\r?\n/);
  const cl = commentLines(f, lines);
  if (generatedGo(f, lines, cl)) continue;
  const dart = f.endsWith(".dart");
  const hash = HASH.test(f);
  const issues = [];
  let start = -1;
  let summaryAt = -1;
  const close = (end) => {
    if (start >= 0 && end - start > MAX_BLOCK)
      issues.push(`${f}:${start + 1} block of ${end - start} lines`);
    start = -1;
  };
  lines.forEach((l, i) => {
    const isC =
      cl[i] &&
      !KEEP.test(l) &&
      !(dart && DART_KEEP.test(l)) &&
      !(hash && HASH_KEEP.test(l));
    if (isC && start < 0) start = i;
    if (!isC) close(i);
    if (f.endsWith(".cs")) {
      if (!/^\s*\/\/\//.test(l)) summaryAt = -1;
      else if (SUMMARY.test(l)) {
        if (summaryAt >= 0)
          issues.push(
            `${f}:${i + 1} second <summary> on one member (line ${summaryAt + 1})`,
          );
        summaryAt = i;
      }
    }
    if (isC && HISTORY.test(l))
      issues.push(`${f}:${i + 1} history: ${l.trim().slice(0, 80)}`);
    else if (isC && !TESTS.test(f) && DATED.test(l))
      issues.push(`${f}:${i + 1} dated: ${l.trim().slice(0, 80)}`);
  });
  close(lines.length);
  if (issues.length) report.push({ f, issues });
}

for (const r of report) r.issues.forEach((x) => console.log(x));

const n = report.reduce((s, r) => s + r.issues.length, 0);
if (n) {
  console.log(
    `\ncomments: ${n} issue(s) in ${report.length} file(s) — rule: ${join(import.meta.dirname, "..", "docs", "code-comments.md")}`,
  );
  if (flag("strict")) process.exit(1);
}
