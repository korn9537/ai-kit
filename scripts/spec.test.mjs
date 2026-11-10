// docs/spec.md names every kit file and names only files that exist, so the map a refactor starts from matches the tree.
// Usage: node scripts/spec.test.mjs
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const spec = readFileSync(join(root, "docs/spec.md"), "utf8");
let passed = 0;
let failed = 0;
function ok(desc, cond) {
  if (cond) {
    passed++;
    console.log(`ok   - ${desc}`);
  } else {
    failed++;
    console.log(`FAIL - ${desc}`);
  }
}

const isTest = (f) => /\.test\.(sh|mjs)$/.test(f);
// a file in a sub-folder (scripts/lib, scripts/kit) must be named by its full path, not its basename
const named = (path) => spec.includes(path) || (!/^scripts\/(kit|lib)\//.test(path) && spec.includes(`\`${path.split("/").pop()}\``));
// folders named as a whole; their files are not listed one by one
const byFolder = new Set(["docs/superpowers"]);

const repoFiles = [];
function walk(rel) {
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const p = `${rel}/${e.name}`;
    if (byFolder.has(p)) ok(`docs/spec.md names ${p}/`, spec.includes(`${p}/`));
    else if (e.isDirectory()) walk(p);
    else {
      repoFiles.push(e.name);
      if (!isTest(e.name)) ok(`docs/spec.md names ${p}`, named(p));
    }
  }
}
for (const dir of ["agents", "commands", "hooks", "githooks", "scripts", "workflows", "docs", "templates", "conventions"]) walk(dir);
for (const f of ["CLAUDE.core.md", "CHANGELOG.md", "README.md", ".gitattributes"]) ok(`docs/spec.md names ${f}`, spec.includes(f));

// every kit path in backticks exists (a bare file name: some kit file has it); project files `ai/...`, git paths and
// patterns with `<` or `*` are skipped
const all = new Set([...repoFiles, "CLAUDE.core.md", "CHANGELOG.md", "README.md", "CLAUDE.md", "plugin.json", "marketplace.json", "proposal.md", "LICENSE", ".gitignore"]);
const skip = (t) => /[<*]/.test(t) || t.startsWith("ai/") || t.startsWith(".githooks/") || t.startsWith(".claude/");
const projectFiles = new Set(["config.json", "pre-commit.sh", "post-edit.sh", "check.sh", "requires.txt", "review-prompt.md",
  "kit-proposals.md", "settings.json", "ai-kit-root"]);
const kitPath = /^(agents|commands|hooks|githooks|scripts|workflows|docs|templates|conventions)\//;
const tokens = [...spec.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]);
for (const t of new Set(tokens)) {
  if (skip(t)) continue;
  if (kitPath.test(t)) ok(`${t} named in docs/spec.md exists`, existsSync(join(root, t)));
  else if (/\.(?:md|sh|mjs|js|json|txt)$/.test(t) && !t.includes("/"))
    ok(`${t} named in docs/spec.md exists`, all.has(t) || projectFiles.has(t));
}

// a prose line over 120 characters (tables and code fences are exempt, as in the wrap check)
spec.split("\n").forEach((l, i) => ok(`docs/spec.md:${i + 1} fits 120 characters`, l.startsWith("|") || l.length <= 120));

// every scripts/kit/ module stays under the 40 KB rule and loads on its own (an import cycle fails here, not in one command)
for (const f of readdirSync(join(root, "scripts/kit")).filter((n) => n.endsWith(".mjs"))) {
  const p = join(root, "scripts/kit", f);
  ok(`scripts/kit/${f} is at most 40 KB`, statSync(p).size <= 40960);
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(p)})`], { encoding: "utf8" });
  ok(`scripts/kit/${f} imports on its own`, r.status === 0);
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
