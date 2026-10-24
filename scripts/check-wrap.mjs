// Kit repo only: added prose lines over 120 characters in staged *.md and *.sh (tables, frontmatter values and
// shell code skipped). Usage, in the ai-kit clone: node scripts/check-wrap.mjs [--staged]; run by .githooks/pre-commit.
import { execFileSync } from "node:child_process";

const MAX = 120;
const staged = process.argv.includes("--staged");
const diff = execFileSync(
  "git",
  ["-c", "core.quotePath=false", "diff", ...(staged ? ["--cached"] : []), "-U0", "--", "*.md", "*.sh"],
  { encoding: "utf8" },
);

const hits = [];
let file = "";
let line = 0;
for (const l of diff.split("\n")) {
  if (l.startsWith("+++ ")) file = l.slice(6);
  else if (l.startsWith("@@")) line = Number(/\+(\d+)/.exec(l)[1]);
  else if (l.startsWith("+")) {
    const text = l.slice(1);
    // a shell file's code lines hold regexes and strings that cannot wrap; its comments can
    const prose = file.endsWith(".sh") ? /^\s*#/.test(text) : !/^\s*\||^[a-z_]+: /.test(text);
    if (prose && [...text].length > MAX) hits.push(`${file}:${line}: ${[...text].length} chars`);
    line++;
  }
}
if (hits.length) {
  console.log(`lines over ${MAX} characters (rewrap):\n${hits.join("\n")}`);
  process.exit(1);
}
