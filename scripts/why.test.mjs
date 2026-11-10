// docs/why.md keeps a row for every wired hook script, git hook and agent, so a reason is read, not guessed.
// Usage: node scripts/why.test.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
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

const why = read("docs/why.md");
const section = (title) => {
  const i = why.indexOf(`## ${title}`);
  const j = why.indexOf("\n## ", i + 1);
  return i < 0 ? "" : why.slice(i, j < 0 ? undefined : j);
};
// the second cell of a live row starts with the file the behavior lives in; a (REMOVED) row covers nothing
const files = (text) =>
  text
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.split(" | ")[0].includes("(REMOVED)"))
    .map((l) => (l.split(" | ")[1] ?? "").replace(/`/g, "").split(" ")[0]);
const hookRows = files(section("Hooks"));

const wired = [...new Set([...read("hooks/hooks.json").matchAll(/hooks\/([\w-]+\.sh)/g)].map((m) => `hooks/${m[1]}`))];
ok("hooks.json wires at least one script", wired.length > 0);
const gitHooks = readdirSync(join(root, "githooks")).filter((f) => !f.includes(".")).map((f) => `githooks/${f}`);
ok("githooks/ holds the git hooks", gitHooks.includes("githooks/pre-commit") && gitHooks.includes("githooks/commit-msg"));
for (const f of [...wired, ...gitHooks]) ok(`docs/why.md has a row for ${f}`, hookRows.includes(f));

const agentIds = section("Agents").split("\n").filter((l) => l.startsWith("| agent.")).map((l) => l.slice(2).split(".")[1]);
for (const a of readdirSync(join(root, "agents")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)))
  ok(`docs/why.md has a row for agents/${a}.md`, agentIds.includes(a));

ok("docs/why.md has rules of CLAUDE.core.md", section("Rules").includes("| core."));

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
