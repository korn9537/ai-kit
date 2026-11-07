// Smoke test for kit.mjs migrate (kit-migrate.mjs) on a small 1.x fixture: the in-repo ai-kit/ copy, its hooks in
// settings, the CLAUDE.md import, an old config and shim. Usage: node scripts/kit-migrate.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dirname, "kit.mjs");
let passed = 0;
let failed = 0;
function eq(desc, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    passed++;
    console.log(`ok   - ${desc}`);
  } else {
    failed++;
    console.log(`FAIL - ${desc}\n  got:  ${g}\n  want: ${w}`);
  }
}

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kit-migrate-")));
const repo = join(tmp, "repo");
const at = (...p) => join(repo, ...p);
const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const put = (rel, text) => {
  mkdirSync(dirname(at(rel)), { recursive: true });
  writeFileSync(at(rel), text);
};
// HOME in the fixture: the user's settings and memory dir never reach the result
const kitCmd = (cmd) => {
  const r = spawnSync("node", [SCRIPT, cmd], { cwd: repo, encoding: "utf8", env: { ...process.env, HOME: repo, CLAUDE_CONFIG_DIR: "" } });
  return { code: r.status, out: r.stdout };
};
const bangs = (out) => out.split("\n").filter((l) => l.startsWith("! ")).map((l) => l.replace(/^! (ai-kit: )?/, "")).sort();

try {
  execFileSync("git", ["init", "-q", repo]);
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  put("ai-kit/sync.mjs", "// 1.x\n");
  put("ai-kit/VERSION", "1.9.0\n");
  put("ai-kit/hooks/x.sh", "#!/bin/sh\n");
  put("ai-kit/agents/change-reviewer.md", "old agent\n");
  put(".claude/agents/change-reviewer.md", "old agent\n");
  put(".claude/settings.json", JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bash ${CLAUDE_PROJECT_DIR}/ai-kit/hooks/x.sh" }] }] } }, null, 2));
  put("CLAUDE.md", "# Project\n\n## Working conventions\n\n@ai-kit/CLAUDE.core.md\n\n## Other\n\nkept\n");
  put("ai/kit/config.json", JSON.stringify({ conventions: [], code_dirs: ["ai-kit", "src"] }, null, 2));
  put("ai/kit/pre-commit.sh", "# Sourced by ai-kit/githooks/pre-commit (POSIX sh, cwd = repo root) after prettier; quiet() is defined there.\n");
  put(".githooks/pre-commit", "#!/bin/sh\nexec sh ai-kit/githooks/pre-commit\n");
  git("add", "-A");
  git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "1.x");

  put("dirty.txt", "x\n");
  const dirty = kitCmd("migrate");
  eq("a dirty tree is refused", [dirty.code, dirty.out.includes("working tree has changes")], [1, true]);
  rmSync(at("dirty.txt"));

  const run = kitCmd("migrate");
  eq("migrate exits 0 and ends the check passed", [run.code, run.out.includes("check: passed")], [0, true]);
  eq("ai-kit/ is gone", existsSync(at("ai-kit")), false);
  eq("the old agent copy is gone", existsSync(at(".claude", "agents", "change-reviewer.md")), false);
  const s = JSON.parse(readFileSync(at(".claude", "settings.json"), "utf8"));
  eq("the 1.x hook is stripped from settings", s.hooks, undefined);
  eq("the plugin is enabled in settings", s.enabledPlugins, { "ai-kit@korn9537": true });
  eq("the marketplace is added", s.extraKnownMarketplaces?.korn9537?.source?.repo, "korn9537/ai-kit");
  const claude = readFileSync(at("CLAUDE.md"), "utf8");
  eq("the CLAUDE.md import is replaced by the pointer", [claude.includes("@ai-kit/"), claude.includes("injected at session start"), claude.includes("kept")], [false, true, true]);
  eq("code_dirs loses ai-kit", JSON.parse(readFileSync(at("ai", "kit", "config.json"), "utf8")).code_dirs, ["src"]);
  eq("the old header wording is replaced", readFileSync(at("ai", "kit", "pre-commit.sh"), "utf8").includes("the ai-kit plugin's githooks/pre-commit"), true);
  eq("the 1.x shim is rewritten by init", readFileSync(at(".githooks", "pre-commit"), "utf8").includes("ai-kit-root"), true);
  eq("the summary lists the deletions", [run.out.includes("deleted ai-kit/"), run.out.includes("deleted .claude/agents/change-reviewer.md")], [true, true]);
  const check = kitCmd("check");
  eq("check agrees with the warnings migrate printed", bangs(run.out), bangs(check.out));
  eq("check passes after migrate", check.code, 0);
  const again = kitCmd("migrate");
  eq("a second run is refused", again.code, 1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
