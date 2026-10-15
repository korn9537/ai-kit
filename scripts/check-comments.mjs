// Reports comments breaking docs/code-comments.md: blocks over 2 lines, history, dates, two C# <summary>s on a member.
// Usage, cwd in the repo: node <plugin>/scripts/check-comments.mjs [--staged] [--strict: exit 1 on an issue] [--top=N] [files...]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const top = Number(
  args.find((a) => a.startsWith("--top="))?.split("=")[1] ?? 0,
);
const MAX_BLOCK = 2;
const git = (...a) =>
  execFileSync("git", a, { encoding: "utf8" }).split("\n").filter(Boolean);
const root = git("rev-parse", "--show-toplevel")[0];
const cwd = process.cwd();
process.chdir(root);
// scope: comments.include/skip in the repo's ai/kit/config.json
const conf = existsSync("ai/kit/config.json")
  ? (JSON.parse(readFileSync("ai/kit/config.json", "utf8")).comments ?? {})
  : {};
const INCLUDE = new RegExp(conf.include ?? "\\.(tsx?|jsx?|mjs|cs)$");
const SKIP = new RegExp(
  conf.skip ?? "(/generated/|/node_modules/|\\.d\\.ts$|\\.Designer\\.cs$)",
);
const HISTORY =
  /\b(used to|previously|was once|no longer|until \d|formerly)\b|เคย|ก่อนหน้านี้/i;
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
const TESTS = /(\/tests?\/|\/e2e\/|\.(test|spec)\.tsx?$|_test\.(go|dart)$)/;
const COMMENT = /^\s*(\/\/|\/\*|\*(?!\*)|\*\/|\{\/\*)/;
const SUMMARY = /^\s*\/\/\/\s*<summary>/;
const KEEP =
  /eslint-disable|@ts-(expect-error|ignore)|#pragma|prettier-ignore|biome-ignore|^\s*\/\/(go:|nolint\b|line )/;
const DART_KEEP = /^\s*\/\/ ignore(_for_file)?:/;
// Go's generated-file marker, valid only in the header before the package clause (go.dev/s/generatedcode)
const GENERATED = /^\/\/ Code generated .* DO NOT EDIT\.$/;
const generatedGo = (f, lines) => {
  if (!f.endsWith(".go")) return false;
  for (const l of lines) {
    if (GENERATED.test(l)) return true;
    if (l.trim() && !COMMENT.test(l)) return false;
  }
  return false;
};

let files = args
  .filter((a) => !a.startsWith("--"))
  .map((f) => relative(root, resolve(cwd, f)));
if (!files.length)
  files = flag("staged")
    ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
    : git("ls-files");
files = files.filter((f) => INCLUDE.test(f) && !SKIP.test(f) && existsSync(f));

const report = [];
for (const f of files) {
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  if (generatedGo(f, lines)) continue;
  const dart = f.endsWith(".dart");
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
      COMMENT.test(l) && !KEEP.test(l) && !(dart && DART_KEEP.test(l));
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
  const total = lines.filter((l) => COMMENT.test(l)).length;
  if (issues.length) report.push({ f, issues, total });
}

if (top) {
  report.sort((a, b) => b.total - a.total);
  for (const r of report.slice(0, top))
    console.log(`${r.total}\t${r.issues.length}\t${r.f}`);
} else for (const r of report) r.issues.forEach((x) => console.log(x));

const n = report.reduce((s, r) => s + r.issues.length, 0);
if (n) {
  console.log(
    `\ncomments: ${n} issue(s) in ${report.length} file(s) — rule: ${join(import.meta.dirname, "..", "docs", "code-comments.md")}`,
  );
  if (flag("strict")) process.exit(1);
}
