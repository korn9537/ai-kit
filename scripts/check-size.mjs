// Blocks a staged edit to a code file over 40 KB at HEAD unless the edit only moves lines out (conventions/general.md
// item 12). Scope: comments.include/skip of ai/kit/config.json. Escape: ALLOW_LARGE_EDIT=1. Usage: node check-size.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const LIMIT = 40 * 1024;
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 30 });
process.chdir(git("rev-parse", "--show-toplevel").trim());
if (process.env.ALLOW_LARGE_EDIT === "1") process.exit(0);
const conf = existsSync("ai/kit/config.json")
  ? (JSON.parse(readFileSync("ai/kit/config.json", "utf8")).comments ?? {})
  : {};
const INCLUDE = new RegExp(conf.include ?? "\\.(tsx?|jsx?|mjs|cs)$");
const SKIP = new RegExp(conf.skip ?? "(/generated/|/node_modules/|\\.d\\.ts$|\\.Designer\\.cs$)");
// a split adds the import of the new file to the old one; a multi-line import runs to its `} from` / `)` line
const WIRING =
  /^(import\b|export\s*(\*|\{[^}]*\}|type\s*\{[^}]*\})\s*(as\s+\w+\s+)?from\b|export\s*(type\s*)?\{$|using\b|(const|let|var)\b.*=\s*require\(|from\s+\S+\s+import\b|require\b)/;
const OPEN = /^(import|export)\b[^;]*\{$|^from\s+\S+\s+import\s*\($/;
const CLOSE = /^\}.*\bfrom\b|^\)$/;

const big = git("diff", "--cached", "--name-only", "--diff-filter=M", "-z")
  .split("\0")
  .filter((f) => f && INCLUDE.test(f) && !SKIP.test(f))
  .map((f) => {
    try {
      return [f, Number(git("cat-file", "-s", `HEAD:${f}`).trim())];
    } catch {
      return [f, 0];
    }
  })
  .filter(([, size]) => size > LIMIT);
if (!big.length) process.exit(0);

// staged lines per file, leading whitespace dropped (a move may re-indent); one diff per name, read literally
const lines = (f) => {
  const out = { "+": [], "-": [] };
  let body = false;
  for (const l of git("diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--", `:(literal)${f}`).split("\n")) {
    if (l.startsWith("@@")) body = true;
    else if (body && /^[+-]/.test(l) && l.slice(1).trim()) out[l[0]].push(l.slice(1).trim());
  }
  return out;
};
const staged = git("diff", "--cached", "--name-only", "--no-renames", "-z").split("\0").filter(Boolean);
const diffs = new Map(staged.map((f) => [f, lines(f)]));

// each removed line elsewhere pays for one added line (a multiset: `}` removed once covers one `}`)
const moveOnly = (f) => {
  const left = new Map();
  for (const [g, d] of diffs)
    if (g !== f) for (const t of d["-"]) left.set(t, (left.get(t) ?? 0) + 1);
  let open = false;
  for (const t of diffs.get(f)["+"]) {
    if (open || WIRING.test(t)) {
      open = open ? !CLOSE.test(t) : OPEN.test(t);
      continue;
    }
    if (!left.get(t)) return false;
    left.set(t, left.get(t) - 1);
  }
  return true;
};

const bad = big.filter(([f]) => !moveOnly(f));
for (const [f, size] of bad)
  console.log(
    `${f} is ${Math.round(size / 1024)} KB at HEAD: split it first in a move-only commit (general.md item 12)`,
  );
if (bad.length) process.exit(1);
