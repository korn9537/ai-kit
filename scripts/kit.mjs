// Wires the ai-kit plugin into a project: node <plugin>/scripts/kit.mjs <init|check>, cwd in the project.
// What each command does: README.md §Commands.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const kit = join(import.meta.dirname, "..");
const PLUGIN = "ai-kit@korn9537";
const IMPORT = "@ai-kit/CLAUDE.core.md";
const MARK = "ai-kit-root";
// what a 1.x shim ran; init replaces such a shim
const OLD_SHIM = "ai-kit/githooks/pre-commit";
const SHIM = `#!/usr/bin/env sh
# ai-kit shim (core.hooksPath): runs the plugin's githooks/pre-commit; session-start.sh records its path.
kit="$(cat "$(git rev-parse --path-format=absolute --git-common-dir)/${MARK}" 2>/dev/null)"
if [ -n "$kit" ] && [ -f "$kit/githooks/pre-commit" ]; then
  exec sh "$kit/githooks/pre-commit" "$@"
fi
echo "warn: ai-kit plugin path unknown: open Claude Code in this repo once"

cd "$(git rev-parse --show-toplevel)" || exit 1
# same helper as the plugin's githooks/pre-commit, which ai/kit/pre-commit.sh may call
quiet() {
  out=$("$@" 2>&1); rc=$?
  if [ $rc -ne 0 ]; then printf '%s\\n' "$out"
  else
    n=$(printf '%s\\n' "$out" | grep -c '^!')
    [ "$n" -gt 0 ] && echo "warn: $n warning(s) from: $* (run it alone for details)"
  fi
  return $rc
}
# shellcheck source=/dev/null
[ -f ai/kit/pre-commit.sh ] && . ai/kit/pre-commit.sh
exit 0
`;

const git = (...a) =>
  execFileSync("git", a, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
const tryGit = (...a) => {
  try {
    return git(...a);
  } catch {
    return null;
  }
};

const root = tryGit("rev-parse", "--show-toplevel") ?? process.cwd();
const at = (...p) => join(root, ...p);
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const shimPath = at(".githooks", "pre-commit");
const isShim = (s) => s?.includes(MARK) ?? false;

function problems() {
  const out = [];
  const confText = read(at("ai", "kit", "config.json"));
  if (confText === null)
    out.push(
      "ai/kit/config.json is missing (fix: node <plugin>/scripts/kit.mjs init, or /ai-kit:init)",
    );
  else {
    let conf;
    try {
      conf = JSON.parse(confText);
    } catch (e) {
      out.push(
        `ai/kit/config.json is not valid JSON (fix: correct the syntax; ${e.message})`,
      );
    }
    if (conf !== undefined) {
      if (conf === null || typeof conf !== "object" || Array.isArray(conf))
        out.push(
          'ai/kit/config.json must be a JSON object (fix: write it as { "conventions": [] } with the keys the kit reads)',
        );
      else {
        const convs = conf.conventions ?? [];
        if (!Array.isArray(convs))
          out.push(
            'ai/kit/config.json conventions must be an array of names (fix: write it as ["go", "sql"] or [])',
          );
        else
          for (const c of convs)
            if (!existsSync(join(kit, "conventions", `${c}.md`)))
              out.push(
                `ai/kit/config.json conventions lists ${c}, but the plugin has no conventions/${c}.md (fix: remove it, or add the file in the ai-kit repo)`,
              );
        if (Array.isArray(conf.code_dirs) && conf.code_dirs.includes("ai-kit"))
          out.push(
            'ai/kit/config.json code_dirs lists "ai-kit", a 1.x in-repo copy (fix: remove it from code_dirs)',
          );
        const doc = conf.shared_checkout_doc;
        if (typeof doc === "string" && !existsSync(isAbsolute(doc) ? doc : at(doc)))
          out.push(
            `ai/kit/config.json shared_checkout_doc names ${doc}, which does not exist (fix: delete the key to use the plugin's docs/shared-checkout.md, or point it at an existing file)`,
          );
      }
    }
  }

  const shim = read(shimPath);
  if (shim === null)
    out.push(
      ".githooks/pre-commit is missing (fix: node <plugin>/scripts/kit.mjs init)",
    );
  else if (shim.includes(OLD_SHIM))
    out.push(
      ".githooks/pre-commit runs the 1.x in-repo kit (fix: node <plugin>/scripts/kit.mjs init rewrites it)",
    );
  else if (!isShim(shim))
    out.push(
      ".githooks/pre-commit is not the ai-kit shim (fix: move its checks into ai/kit/pre-commit.sh, delete it, then run init)",
    );
  const hp = tryGit("config", "core.hooksPath") ?? "";
  if (hp !== ".githooks")
    out.push(
      `core.hooksPath is ${hp || "unset"}, so the kit pre-commit never runs (fix: move other hooks into ai/kit/pre-commit.sh, then git config core.hooksPath .githooks)`,
    );

  // Claude Code applies the highest scope that sets the plugin: local, then project, then user
  const scopes = [
    at(".claude", "settings.local.json"),
    at(".claude", "settings.json"),
    join(homedir(), ".claude", "settings.json"),
  ];
  let setIn = null;
  for (const p of scopes) {
    let s;
    try {
      s = JSON.parse(read(p) ?? "{}") ?? {};
    } catch (e) {
      out.push(`${p} is not valid JSON (fix: correct the syntax; ${e.message})`);
      continue;
    }
    const ep = s.enabledPlugins;
    if (ep && typeof ep === "object" && Object.hasOwn(ep, PLUGIN)) {
      setIn = { p, v: ep[PLUGIN] };
      break;
    }
  }
  if (!setIn)
    out.push(
      `the plugin is not enabled in .claude/settings.json, .claude/settings.local.json or ~/.claude/settings.json (fix: add "enabledPlugins": {"${PLUGIN}": true} and the korn9537 marketplace to the project .claude/settings.json, the recommended place so teammates get it, README.md §Install)`,
    );
  else if (setIn.v !== true)
    out.push(
      `${setIn.p} disables the plugin ("enabledPlugins": {"${PLUGIN}": ${JSON.stringify(setIn.v)}}) and overrides lower scopes (fix: set it to true or remove that entry)`,
    );
  for (const f of ["settings.json", "settings.local.json"]) {
    let s;
    try {
      s = JSON.parse(read(at(".claude", f)) ?? "{}") ?? {};
    } catch {
      continue;
    }
    const old = Object.values(s.hooks ?? {})
      .flatMap((gs) => (Array.isArray(gs) ? gs : []))
      .flatMap((g) => g.hooks ?? [])
      .map((h) => h.command ?? "")
      .filter((c) => c.includes("ai-kit/hooks/"));
    for (const c of old)
      out.push(
        `.claude/${f} still runs a hook from an in-repo ai-kit/ copy (fix: delete that entry; the plugin runs it): ${c}`,
      );
  }
  for (const a of ["business-analyst.md", "change-reviewer.md"])
    if (existsSync(at(".claude", "agents", a)))
      out.push(
        `.claude/agents/${a} is an old kit copy that shadows the plugin agent (fix: delete it)`,
      );
  if (read(at("CLAUDE.md"))?.includes(IMPORT))
    out.push(
      `CLAUDE.md still imports ${IMPORT} (fix: delete that line; the plugin injects it at session start)`,
    );
  return out;
}

function init() {
  const tpl = join(kit, "templates", "ai-kit-project");
  mkdirSync(at("ai", "kit"), { recursive: true });
  for (const f of readdirSync(tpl))
    if (!existsSync(at("ai", "kit", f))) {
      copyFileSync(join(tpl, f), at("ai", "kit", f));
      console.log(`+ ai/kit/${f} (fill it in for this project)`);
    }

  const shim = read(shimPath);
  if (shim === null) {
    mkdirSync(at(".githooks"), { recursive: true });
    writeFileSync(shimPath, SHIM, { mode: 0o755 });
    console.log("+ .githooks/pre-commit");
  } else if (!isShim(shim) && !shim.includes(OLD_SHIM))
    console.log(
      "! .githooks/pre-commit exists and does not run the kit: move its checks into ai/kit/pre-commit.sh, delete it, then rerun init",
    );
  else if (shim !== SHIM) {
    writeFileSync(shimPath, SHIM, { mode: 0o755 });
    console.log("~ .githooks/pre-commit (shim updated)");
  }

  // another hooks path (husky) would be switched off silently: leave it to the user
  const hp = tryGit("config", "core.hooksPath") ?? "";
  if (hp && hp !== ".githooks")
    console.log(
      `! core.hooksPath is ${hp}: move those hooks into ai/kit/pre-commit.sh, then git config core.hooksPath .githooks`,
    );
  else if (!hp && tryGit("config", "core.hooksPath", ".githooks") === null)
    console.log("! not a git repo: core.hooksPath not set");

  // the shim reads this; session-start.sh rewrites it each session
  const common = tryGit("rev-parse", "--path-format=absolute", "--git-common-dir");
  if (common && existsSync(common)) {
    try {
      writeFileSync(join(common, MARK), `${kit}\n`);
      console.log(`+ ${join(common, MARK)}`);
    } catch (e) {
      console.log(`! could not write ${join(common, MARK)}: ${e.message}`);
    }
  }

  const left = problems();
  left.forEach((p) => console.log(`! ${p}`));
  console.log(left.length ? "init done; problems above" : "ai-kit ready");
  console.log(
    "restart the Claude Code session so the SessionStart hook injects the working conventions",
  );
}

const cmd = process.argv[2];
if (cmd === "init") init();
else if (cmd === "check") {
  const out = problems();
  out.forEach((p) => console.log(`ai-kit: ${p}`));
  if (out.length) process.exit(1);
} else {
  console.log("usage: node <plugin>/scripts/kit.mjs <init|check>");
  process.exit(2);
}
