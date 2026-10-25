// Wires the ai-kit plugin into a project, cwd in the project:
// node <plugin>/scripts/kit.mjs <init|check|migrate|inventory>
// What each command does: README.md §Commands.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

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

// every call runs at the repo root, so pathspecs and output are root-relative from a subdirectory too
const gitIn = (cwd, a) =>
  execFileSync("git", a, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    // ls-files of a large repo is several MB; over the buffer the call fails and reads as empty
    maxBuffer: 1 << 30,
  }).trim();
const tryGitIn = (cwd, a) => {
  try {
    return gitIn(cwd, a);
  } catch {
    return null;
  }
};

const root =
  tryGitIn(process.cwd(), ["rev-parse", "--show-toplevel"]) ?? process.cwd();
const tryGit = (...a) => tryGitIn(root, a);
const at = (...p) => join(root, ...p);
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const shimPath = at(".githooks", "pre-commit");
const isShim = (s) => s?.includes(MARK) ?? false;
// only the 1.x wiring: ${CLAUDE_PROJECT_DIR}/ai-kit/hooks/, $CLAUDE_PROJECT_DIR/..., or a relative ai-kit/hooks/
const KIT_HOOK =
  /(^|["'\s])(\$\{CLAUDE_PROJECT_DIR\}["']?\/|\$CLAUDE_PROJECT_DIR["']?\/|\.\/)?ai-kit\/hooks\//;
const isKitHook = (h) => KIT_HOOK.test(h?.command ?? "");
const isImportLine = (l) => l.trim().replace(/^[-*]\s+/, "") === IMPORT;
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
// Claude Code's auto-memory dir: main worktree path, non-alphanumerics -> '-' (hooks/lib.sh too); a long path's
// hashed slug and autoMemoryDirectory are not followed, so a miss only skips the warning
const memoryDir = () => {
  const common = tryGit("rev-parse", "--path-format=absolute", "--git-common-dir");
  const main = common?.replace(/\/\.git$/, "") || root;
  return join(claudeDir(), "projects", main.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
};
// MEMORY.md counts only when it holds more than index links
const memoryFiles = () => {
  const d = memoryDir();
  if (!existsSync(d)) return [];
  return readdirSync(d).filter(
    (f) =>
      f.endsWith(".md") &&
      (f !== "MEMORY.md" ||
        readFileSync(join(d, f), "utf8")
          .split(/\r?\n/)
          .some((l) => l.trim() && !/^\s*(#|[-*]\s+\[[^\]]*\]\([^)]*\))/.test(l))),
  );
};
// warnings, not problems: this machine's state, and a project before 2.7.0 must keep committing
function memoryWarnings() {
  const out = [];
  const scopes = [
    at(".claude", "settings.local.json"),
    at(".claude", "settings.json"),
    join(claudeDir(), "settings.json"),
  ];
  let off = { 0: false, 1: true }[process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY];
  let mem;
  for (const p of scopes) {
    let s;
    try {
      s = JSON.parse(read(p) ?? "{}") ?? {};
    } catch {
      continue;
    }
    const e = s.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
    if (off === undefined && (e === "0" || e === "1")) off = e === "1";
    if (!mem && Object.hasOwn(s, "autoMemoryEnabled")) mem = { p, v: s.autoMemoryEnabled };
  }
  if (off === false)
    out.push("CLAUDE_CODE_DISABLE_AUTO_MEMORY=0 turns auto-memory on over the settings (fix: unset it)");
  else if (off === undefined && !mem)
    out.push('.claude/settings.json does not turn off auto-memory (fix: add "autoMemoryEnabled": false, or run init)');
  else if (off === undefined && mem.v !== false)
    out.push(`${mem.p} sets "autoMemoryEnabled": ${JSON.stringify(mem.v)} and overrides lower scopes (fix: remove that key)`);
  const left = memoryFiles();
  if (left.length)
    out.push(`${memoryDir()} holds ${left.length} memory file(s) the team cannot see (fix: /ai-kit:memory-export)`);
  return out;
}

const UI_PLATFORMS = ["web", "mobile"];
const WEB_DEPS = ["next", "react", "react-dom", "vue", "nuxt", "svelte", "@sveltejs/kit", "@angular/core", "solid-js"];
// platforms the root, a tracked top-level folder or an apps/* or packages/* folder looks like; mobile wins over
// web (React Native ships react too); docs sites and examples do not count
function detectUi() {
  const dirs = [root];
  // folders holding a tracked file, from one listing
  const tracked = new Set();
  for (const f of lsFiles()) {
    const p = f.split("/");
    for (let i = 1; i < Math.min(p.length, 3); i++) tracked.add(p.slice(0, i).join("/"));
  }
  for (const parent of [[], ["apps"], ["packages"]])
    try {
      for (const d of readdirSync(at(...parent), { withFileTypes: true }))
        if (
          d.isDirectory() &&
          !/^(\.|node_modules$|docs?$|website$|examples?$)/.test(d.name) &&
          tracked.has([...parent, d.name].join("/"))
        )
          dirs.push(at(...parent, d.name));
    } catch {}
  const found = new Set();
  for (const d of dirs) {
    let pkg = {};
    try {
      pkg = JSON.parse(read(join(d, "package.json")) ?? "{}") ?? {};
    } catch {}
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (
      /^\s*flutter:/m.test(read(join(d, "pubspec.yaml")) ?? "") ||
      deps["react-native"] ||
      deps.expo ||
      (existsSync(join(d, "android")) && existsSync(join(d, "ios")))
    )
      found.add("mobile");
    else if (WEB_DEPS.some((k) => deps[k])) found.add("web");
  }
  return UI_PLATFORMS.filter((p) => found.has(p));
}
// the docs.include of templates before 2.8.0; docs/ai-docs.md now governs ai/ only
const OLD_DOCS_INCLUDE = "^(CLAUDE\\.md|(docs|ai)/.*\\.md)$";
function docsWarnings() {
  let conf;
  try {
    conf = JSON.parse(read(at("ai", "kit", "config.json")) ?? "null");
  } catch {
    return [];
  }
  return conf?.docs?.include === OLD_DOCS_INCLUDE
    ? [
        `ai/kit/config.json docs.include still checks docs/ and CLAUDE.md, which the AI-only doc rule no longer governs (fix: set "include": ${JSON.stringify("^ai/.*\\.md$")})`,
      ]
    : [];
}
// top-level entries of ai/ (docs/ai-layout.md); a path ui.api or analysis-sources.md names is allowed too
const AI_LAYOUT = ["kit", "decisions.md", "requirements", "data", "specs", "screens", "api", "plans", "notes.md"];
function layoutWarnings() {
  let ents;
  try {
    ents = readdirSync(at("ai")).filter((e) => !e.startsWith("."));
  } catch {
    return [];
  }
  let api = null;
  try {
    api = JSON.parse(read(at("ai", "kit", "config.json")) ?? "null")?.ui?.api;
  } catch {}
  const allowed = new Set(AI_LAYOUT);
  if (typeof api === "string") allowed.add(/^(?:\.\/)?ai\/([^/]+)/.exec(api)?.[1]);
  // a category kept elsewhere under ai/, named in backticks by analysis-sources.md
  for (const m of (read(at("ai", "kit", "analysis-sources.md")) ?? "").matchAll(/`(?:\.\/)?ai\/([^/`\s]+)/g))
    allowed.add(m[1]);
  return ents
    .filter((e) => !allowed.has(e))
    .map(
      (e) =>
        `ai/${e} is not an ai/ category (fix: when next touched, move it into the category that fits, or out of ai/ when humans read it, move-only commit; the plugin's docs/ai-layout.md)`,
    );
}
// warnings, not problems: a UI project before 2.8.0 must keep committing (docs/screen-specs.md)
function uiWarnings() {
  let conf;
  try {
    conf = JSON.parse(read(at("ai", "kit", "config.json")) ?? "null");
  } catch {
    return [];
  }
  if (!isObj(conf)) return [];
  if (conf.ui === undefined) {
    const found = detectUi();
    return found.length
      ? [
          `ai/kit/config.json has no ui key, but this looks like a ${found.join(" and ")} project (fix: add "ui": {"platforms": ${JSON.stringify(found)}, "include": "<regex of screen entry files>", "api": "ai/api/"}, or "ui": {"platforms": []} for none; the plugin's docs/screen-specs.md)`,
        ]
      : [];
  }
  if (
    isObj(conf.ui) &&
    Array.isArray(conf.ui.platforms) &&
    conf.ui.platforms.length &&
    !existsSync(at("ai", "screens", "index.md"))
  )
    return [
      "ai/kit/config.json sets ui.platforms, but ai/screens/index.md is missing (fix: create it, one line per screen; spec each screen when it is next changed, not all now; the plugin's docs/screen-specs.md)",
    ];
  return [];
}

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
        if (conf.ui !== undefined) {
          const ui = conf.ui;
          if (!isObj(ui))
            out.push(
              `ai/kit/config.json ui must be an object (fix: write it as {"platforms": [], "include": "^$", "api": "ai/api/"}, the plugin's docs/screen-specs.md)`,
            );
          else {
            const pl = ui.platforms ?? [];
            if (!Array.isArray(pl) || pl.some((p) => !UI_PLATFORMS.includes(p)))
              out.push(
                `ai/kit/config.json ui.platforms must be an array of ${UI_PLATFORMS.map((p) => `"${p}"`).join(", ")} (fix: write it as ["web"] or [])`,
              );
            for (const k of ["include", "api"])
              if (ui[k] !== undefined && typeof ui[k] !== "string")
                out.push(`ai/kit/config.json ui.${k} must be a string (fix: the plugin's docs/screen-specs.md §Config)`);
            if (typeof ui.include === "string")
              try {
                new RegExp(ui.include);
              } catch (e) {
                out.push(`ai/kit/config.json ui.include is not a valid regex (fix: correct it; ${e.message})`);
              }
          }
        }
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
      `the plugin is not enabled in .claude/settings.json, .claude/settings.local.json or ~/.claude/settings.json (fix: add "enabledPlugins": {"${PLUGIN}": true} and the korn9537 marketplace to the project .claude/settings.json, the recommended place so teammates get it, README.md §Install in a project)`,
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
      .flatMap((g) => g?.hooks ?? [])
      .filter(isKitHook)
      .map((h) => h.command);
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
  if (read(at("CLAUDE.md"))?.split(/\r?\n/).some(isImportLine))
    out.push(
      `CLAUDE.md still imports ${IMPORT} (fix: delete that line; the plugin injects it at session start)`,
    );
  return out;
}

// created collects the root-relative paths of files this run adds
function initFiles(created = []) {
  const tpl = join(kit, "templates", "ai-kit-project");
  mkdirSync(at("ai", "kit"), { recursive: true });
  for (const f of readdirSync(tpl))
    if (!existsSync(at("ai", "kit", f))) {
      copyFileSync(join(tpl, f), at("ai", "kit", f));
      created.push(`ai/kit/${f}`);
      console.log(`+ ai/kit/${f} (fill it in for this project)`);
    }

  const shim = read(shimPath);
  if (shim === null) {
    mkdirSync(at(".githooks"), { recursive: true });
    writeFileSync(shimPath, SHIM, { mode: 0o755 });
    created.push(".githooks/pre-commit");
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

  // project scope so teammates get it; settings.local.json and user scope are the user's (check reports them)
  const sp = at(".claude", "settings.json");
  const st = read(sp);
  let sj;
  try {
    sj = JSON.parse(st ?? "{}") ?? {};
  } catch {}
  if (isObj(sj) && !Object.hasOwn(sj, "autoMemoryEnabled")) {
    sj.autoMemoryEnabled = false;
    mkdirSync(at(".claude"), { recursive: true });
    writeFileSync(sp, jsonText(sj, st ? eolOf(st) : "\n"));
    if (st === null) created.push(".claude/settings.json");
    console.log('~ .claude/settings.json ("autoMemoryEnabled": false)');
  }

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
}

function init() {
  initFiles();
  const left = problems();
  left.forEach((p) => console.log(`! ${p}`));
  memoryWarnings().forEach((w) => console.log(`! ${w}`));
  uiWarnings().forEach((w) => console.log(`! ${w}`));
  docsWarnings().forEach((w) => console.log(`! ${w}`));
  layoutWarnings().forEach((w) => console.log(`! ${w}`));
  console.log(left.length ? "init done; problems above" : "ai-kit ready");
  console.log(
    "restart the Claude Code session so the SessionStart hook injects the working conventions",
  );
}

// 1.x header lines of ai/kit/ files (old template wording) -> current template wording
const OLD_HEADERS = {
  "Reader: the `business-analyst` agent (`ai-kit/agents/business-analyst.md`). Sources in this order of authority.":
    "Reader: the `business-analyst` agent (`agents/business-analyst.md` in the ai-kit plugin). Sources in this order of authority.",
  "Reader: the `change-reviewer` agent (`ai-kit/agents/change-reviewer.md`). Check each item the diff touches.":
    "Reader: the `change-reviewer` agent (`agents/change-reviewer.md` in the ai-kit plugin). Check each item the diff touches.",
  "# Sourced by ai-kit/hooks/post-edit-check.sh with $rel (repo-relative file) and run <label> <filter|-> <cmd...>.":
    "# Sourced by the ai-kit plugin's hooks/post-edit-check.sh with $rel (repo-relative file) and run <label> <filter|-> <cmd...>.",
  "# Sourced by ai-kit/githooks/pre-commit (POSIX sh, cwd = repo root) after prettier; quiet() is defined there.":
    "# Sourced by the ai-kit plugin's githooks/pre-commit (POSIX sh, cwd = repo root) after prettier; quiet() is defined there.",
};
const POINTER =
  "Working conventions come from the ai-kit plugin (korn9537/ai-kit), injected at session start; project settings in `ai/kit/`.";
const eolOf = (t) => (t.includes("\r\n") ? "\r\n" : "\n");
const jsonText = (o, eol) =>
  `${JSON.stringify(o, null, 2).replace(/\n/g, eol)}${eol}`;
const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const lexists = (p) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
const lsFiles = (...a) =>
  (tryGit("ls-files", "-z", ...a) ?? "").split("\0").filter(Boolean);

function stripKitHooks(s) {
  if (!s.hooks || typeof s.hooks !== "object") return false;
  let changed = false;
  for (const [ev, groups] of Object.entries(s.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      const hs = Array.isArray(g?.hooks) ? g.hooks : null;
      if (!hs || !hs.some(isKitHook)) {
        kept.push(g);
        continue;
      }
      changed = true;
      const rest = hs.filter((h) => !isKitHook(h));
      if (rest.length) kept.push({ ...g, hooks: rest });
    }
    if (kept.length) s.hooks[ev] = kept;
    else delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return changed;
}

// why ai-kit/ is not the tracked 1.x copy, or null when it is
function notKitCopy() {
  const d = at("ai-kit");
  if (lstatSync(d).isSymbolicLink()) return "is a symlink";
  if ((tryGit("ls-files", "-s", "--", "ai-kit") ?? "").startsWith("160000"))
    return "is a submodule";
  if (lexists(join(d, ".git"))) return "holds a .git (a clone, not the copy)";
  if (!existsSync(join(d, "sync.mjs"))) return "has no sync.mjs";
  if (!lsFiles("--", "ai-kit/sync.mjs").length)
    return "has a sync.mjs git does not track (ignored or untracked)";
  return null;
}

function pruneEmpty(dir) {
  if (!lexists(dir) || !lstatSync(dir).isDirectory()) return;
  for (const e of readdirSync(dir)) pruneEmpty(join(dir, e));
  if (!readdirSync(dir).length) rmdirSync(dir);
}

// shell-quotes a path for the suggested git add line
const shq = (p) =>
  /^[\w./@:+-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`;

function fail(msg) {
  console.log(`ai-kit migrate: ${msg}`);
  process.exit(1);
}

function migrate() {
  // 1. validate and plan: nothing on disk changes until every input has been read
  const status = tryGit("status", "--porcelain");
  if (status === null) fail("not inside a git repo");
  if (status)
    fail(
      "the working tree has changes; commit or stash them first, so the migration is its own diff",
    );

  const settingsP = at(".claude", "settings.json");
  const localP = at(".claude", "settings.local.json");
  const settings = {};
  const settingsText = {};
  for (const p of [settingsP, localP]) {
    const t = read(p);
    if (t === null) continue;
    let s;
    try {
      s = JSON.parse(t) ?? {};
    } catch (e) {
      fail(`${p} is not valid JSON; fix it first (${e.message})`);
    }
    if (!isObj(s)) fail(`${p} is not a JSON object; fix it first`);
    for (const k of ["extraKnownMarketplaces", "enabledPlugins"])
      if (s[k] !== undefined && !isObj(s[k]))
        fail(`${p} ${k} is not a JSON object; fix it first`);
    settings[p] = s;
    settingsText[p] = t;
  }
  const confP = at("ai", "kit", "config.json");
  const confText = read(confP);
  let conf = null;
  try {
    conf = confText === null ? null : JSON.parse(confText);
  } catch (e) {
    fail(`ai/kit/config.json is not valid JSON; fix it first (${e.message})`);
  }

  const kitDir = at("ai-kit");
  const kitExists = lexists(kitDir);
  const claudeMd = read(at("CLAUDE.md"));
  const hasImport =
    claudeMd?.split(/\r?\n/).some(isImportLine) ?? false;
  const hasHooks = Object.values(settings).some((s) =>
    stripKitHooks(structuredClone(s)),
  );
  if (!kitExists && !hasHooks && !hasImport)
    fail(
      "nothing from ai-kit 1.x here (no ai-kit/, no ai-kit/hooks/ entries in settings, no @ai-kit import); run init instead",
    );
  if (kitExists) {
    const why = notKitCopy();
    if (why)
      fail(
        `ai-kit/ ${why}, so it is not the tracked 1.x copy and was left alone; move or delete it by hand, then rerun`,
      );
  }

  const writes = [];
  const dels = [];
  const byHand = [];
  const recover = (p) => `recover: git show HEAD:${p}`;

  if (kitExists) {
    dels.push(...lsFiles("--", "ai-kit"));
    const extra = (tryGit("ls-files", "--others", "--", "ai-kit") ?? "")
      .split("\n")
      .filter(Boolean);
    if (extra.length)
      byHand.push(
        `ai-kit/ keeps ${extra.length} file(s) git does not track, left in place (e.g. ${extra[0]}); delete them by hand`,
      );
    // 1.x-only files have no plugin counterpart by design
    const oldOnly = new Set(["sync.mjs", "settings.hooks.json", "VERSION"]);
    for (const d of dels) {
      const x = d.slice("ai-kit/".length);
      if (!oldOnly.has(x) && !existsSync(join(kit, x)))
        byHand.push(
          `${d} has no counterpart in the plugin, deleted (${recover(d)})`,
        );
    }
  }
  for (const a of ["business-analyst.md", "change-reviewer.md"]) {
    const rel = `.claude/agents/${a}`;
    if (!lexists(at(rel))) continue;
    if (!lsFiles("--", rel).length) {
      byHand.push(
        `${rel} is not tracked by git, so it was left in place; delete it by hand if it is the old kit copy`,
      );
      continue;
    }
    if (read(at(rel)) !== read(join(kitDir, "agents", a)))
      byHand.push(
        `${rel} differs from ai-kit/agents/${a} (local edits?), deleted (${recover(rel)})`,
      );
    dels.push(rel);
  }

  for (const [p, s] of Object.entries(settings))
    if (p !== settingsP && stripKitHooks(s))
      writes.push({
        rel: ".claude/settings.local.json",
        text: jsonText(s, eolOf(settingsText[p])),
      });
  const s = settings[settingsP] ?? {};
  stripKitHooks(s);
  if (!Object.hasOwn(s.extraKnownMarketplaces ?? {}, "korn9537"))
    s.extraKnownMarketplaces = {
      ...(s.extraKnownMarketplaces ?? {}),
      korn9537: {
        source: { source: "github", repo: "korn9537/ai-kit" },
        autoUpdate: true,
      },
    };
  if (!Object.hasOwn(s.enabledPlugins ?? {}, PLUGIN))
    s.enabledPlugins = { ...(s.enabledPlugins ?? {}), [PLUGIN]: true };
  else if (s.enabledPlugins[PLUGIN] !== true)
    byHand.push(
      `.claude/settings.json sets "${PLUGIN}": ${JSON.stringify(s.enabledPlugins[PLUGIN])}, left as is; set it to true to turn the plugin on`,
    );
  const sText = jsonText(s, eolOf(settingsText[settingsP] ?? "\n"));
  if (sText !== settingsText[settingsP])
    writes.push({ rel: ".claude/settings.json", text: sText });

  if (hasImport) {
    const eol = eolOf(claudeMd);
    let lines = claudeMd.split(/\r?\n/);
    const i = lines.findIndex(isImportLine);
    lines = lines.filter((l) => !isImportLine(l));
    // the section from its heading to the next heading of level 1-2, or the end
    let h = i - 1;
    while (h >= 0 && !/^#{1,2}\s/.test(lines[h])) h--;
    let end = i;
    while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
    if (
      h >= 0 &&
      /^##\s+Working conventions\s*$/.test(lines[h]) &&
      lines.slice(h + 1, end).every((l) => !l.trim())
    )
      lines.splice(
        h + 1,
        end - h - 1,
        "",
        POINTER,
        ...(end < lines.length ? [""] : []),
      );
    writes.push({
      rel: "CLAUDE.md",
      text: `${lines.join(eol).replace(/\s+$/, "")}${eol}`,
    });
  }

  if (isObj(conf)) {
    const want = structuredClone(conf);
    if (Array.isArray(want.code_dirs))
      want.code_dirs = want.code_dirs.filter((d) => d !== "ai-kit");
    if (
      typeof want.shared_checkout_doc === "string" &&
      want.shared_checkout_doc.startsWith("ai-kit/")
    )
      delete want.shared_checkout_doc;
    if (JSON.stringify(want) !== JSON.stringify(conf)) {
      // edit the text to keep its layout; fall back to a rewrite if the result differs
      const text = confText
        .replace(
          /("code_dirs"\s*:\s*\[)([^\]]*)\]/,
          (_, a, inner) =>
            `${a}${inner
              .replace(/\s*"ai-kit"\s*,/, "")
              .replace(/,\s*"ai-kit"(?=\s*$)/, "")
              .replace(/^\s*"ai-kit"\s*$/, "")}]`,
        )
        .replace(/\r?\n\s*"shared_checkout_doc"\s*:\s*"ai-kit\/[^"]*"\s*,/, "")
        .replace(/,\s*"shared_checkout_doc"\s*:\s*"ai-kit\/[^"]*"(?=\s*\})/, "");
      let ok = false;
      try {
        ok = JSON.stringify(JSON.parse(text)) === JSON.stringify(want);
      } catch {}
      writes.push({
        rel: "ai/kit/config.json",
        text: ok ? text : jsonText(want, eolOf(confText)),
      });
    }
  }

  const kitFiles = existsSync(at("ai", "kit"))
    ? readdirSync(at("ai", "kit")).filter((f) => /\.(sh|md)$/.test(f))
    : [];
  for (const f of kitFiles) {
    const t = read(at("ai", "kit", f));
    const lines = t.split(/\r?\n/);
    let n = 0;
    lines.forEach((l, i) => {
      if (Object.hasOwn(OLD_HEADERS, l)) {
        lines[i] = OLD_HEADERS[l];
        n++;
      }
    });
    if (n) writes.push({ rel: `ai/kit/${f}`, text: lines.join(eolOf(t)) });
  }
  const after = (rel) =>
    writes.find((w) => w.rel === rel)?.text ?? read(at(rel)) ?? "";
  for (const f of [
    "CLAUDE.md",
    ...kitFiles.map((f) => `ai/kit/${f}`),
    "ai/kit/config.json",
  ])
    after(f)
      .split(/\r?\n/)
      .forEach((l, i) => {
        if (l.includes("ai-kit/"))
          byHand.push(`${f}:${i + 1} still cites ai-kit/: ${l.trim()}`);
      });

  // 2. write, then run init, then delete last, so a failure leaves every deleted file in place
  const done = [];
  const created = [];
  try {
    for (const w of writes) {
      mkdirSync(dirname(at(w.rel)), { recursive: true });
      const isNew = !lexists(at(w.rel));
      writeFileSync(at(w.rel), w.text);
      if (isNew) created.push(w.rel);
      done.push(`changed ${w.rel}`);
    }
    console.log("ai-kit migrate: running init");
    initFiles(created);
    done.push("ran init (its + lines above)");
    for (const d of dels) {
      rmSync(at(d), { force: true });
      done.push(`deleted ${d}`);
    }
    pruneEmpty(kitDir);
    pruneEmpty(at(".claude", "agents"));
  } catch (e) {
    console.log(`\nai-kit migrate: stopped: ${e.message}`);
    console.log(done.length ? "done before the stop:" : "nothing was changed");
    done.forEach((d) => console.log(`  ${d}`));
    console.log(
      `recover: in ${root} run git restore --source=HEAD --staged --worktree -- :/${created.length ? `, delete the files migrate created (${created.join(", ")})` : ""}, fix the cause, then rerun migrate`,
    );
    process.exit(1);
  }

  const left = problems();
  console.log("\nai-kit migrate summary");
  const kitN = dels.filter((d) => d.startsWith("ai-kit/")).length;
  if (kitN)
    console.log(
      `- deleted ai-kit/ (${kitN} tracked files; local edits to a kit file: git show HEAD:ai-kit/<file>)`,
    );
  dels
    .filter((d) => !d.startsWith("ai-kit/"))
    .forEach((d) => console.log(`- deleted ${d}`));
  writes.forEach((w) => console.log(`~ changed ${w.rel}`));
  if (byHand.length) {
    console.log("review by hand:");
    byHand.forEach((b) => console.log(`  ${b}`));
  }
  left.forEach((p) => console.log(`! ${p}`));
  memoryWarnings().forEach((w) => console.log(`! ${w}`));
  uiWarnings().forEach((w) => console.log(`! ${w}`));
  docsWarnings().forEach((w) => console.log(`! ${w}`));
  layoutWarnings().forEach((w) => console.log(`! ${w}`));
  console.log(left.length ? `check: ${left.length} problem(s)` : "check: passed");
  // the tree was clean, so status lists exactly what migrate changed that git tracks or would add
  const changedPaths = [
    ...new Set(
      execFileSync(
        "git",
        ["status", "--porcelain", "-z", "--untracked-files=all"],
        { cwd: root, encoding: "utf8" },
      )
        .split("\0")
        .filter(Boolean)
        .map((e) => e.slice(3))
        .map((p) => (p.startsWith("ai-kit/") ? "ai-kit/" : p)),
    ),
  ];
  console.log(`next steps:
  1. review git status and git diff
  2. stage by name (git add -- ${changedPaths.map(shq).join(" ")}), then commit
  3. open Claude Code in the repo, trust the folder so it installs the plugin, and restart the session`);
  if (left.length) process.exit(1);
}

// inventory: what a retrofit (commands/retrofit.md) starts from; heuristics over tracked files, read-only
const INV = {
  schema: [
    /(^|\/)prisma\/schema\.prisma$/,
    /(^|\/)(migrations?|db\/migrate|alembic\/versions)\/.+\.(sql|ts|js|py|rb|go|cs)$/i,
    /(^|\/)(models?|entities|entity)\/[^/]+\.(ts|js|py|rb|go|cs|dart)$/i,
    /(^|\/)Configurations\/(.+\/)?[^/]+Configuration\.cs$/,
    /\.entity\.ts$/,
    /(^|\/)(schema|db\/schema)\.(ts|sql|rb)$/,
    /DbContext\.cs$/,
  ],
  screens: [
    /(^|\/)app\/(.+\/)?page\.(tsx|jsx|ts|js)$/,
    /(^|\/)pages\/(?!api\/).+\.(tsx|jsx|vue)$/,
    /(^|\/)routes\/(.+\/)?\+page\.svelte$/,
    /(^|\/)views\/.+\.vue$/,
    /(^|\/)screens\/.+\.(tsx|jsx|dart)$/,
    /_screen\.dart$/,
  ],
  api: [/(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$/i],
  routes: [
    /(^|\/)app\/(.+\/)?route\.(ts|js)$/,
    /(^|\/)pages\/api\//,
    /(^|\/)(routes|controllers|handlers|endpoints)\/.+\.(ts|js|py|rb|go|cs)$/i,
    /(Controller|Endpoints?)\.cs$/,
  ],
  decisions: [/(^|\/)(adrs?|decisions?)(\/.*)?[^/]*\.(md|markdown|adoc|txt)$/i],
};
const SKIP_DIRS = /(^|\/)(node_modules|vendor|dist|build|\.next|Pods|\.dart_tool)\//;
// "dir/ (n files)" lines, largest first; deeper folders fold into their parents until at most 40 remain
const grouped = (files) => {
  const dirs = files.map((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")).split("/") : []));
  let depth = Math.max(0, ...dirs.map((d) => d.length));
  let by;
  for (;;) {
    by = new Map();
    for (const d of dirs) {
      const k = d.length ? `${d.slice(0, depth).join("/")}/` : "./";
      by.set(k, (by.get(k) ?? 0) + 1);
    }
    if (by.size <= 40 || depth <= 1) break;
    depth--;
  }
  return [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d, n]) => `  ${d} (${n})`);
};
function inventory() {
  const all = lsFiles();
  if (!all.length) console.log("! git lists no tracked files here: inventory is empty");
  const files = all.filter((f) => !SKIP_DIRS.test(f) && !f.startsWith("ai/"));
  let conf = {};
  try {
    conf = JSON.parse(read(at("ai", "kit", "config.json")) ?? "{}") ?? {};
  } catch {}
  const out = ["ai-kit inventory (heuristics: verify each group against the code)"];
  // n: files in the section, when the lines are folder groups
  const sec = (title, list, n = list.length) => {
    out.push(`\n## ${title} (${n})`);
    out.push(...(list.length ? list : ["  none"]));
  };
  out.push(`ui: ${conf.ui === undefined ? "unset" : JSON.stringify(conf.ui)} · detected: ${detectUi().join(", ") || "none"}`);
  out.push(`docs.include: ${JSON.stringify(conf.docs?.include ?? null)}`);
  sec("ai/ entries outside the layout", layoutWarnings().map((w) => `  ${w.split(" ")[0]}`));
  const hit = (k) => files.filter((f) => INV[k].some((re) => re.test(f)));
  const schema = hit("schema");
  sec("schema sources → ai/data/", grouped(schema), schema.length);
  const screens = hit("screens");
  sec("screen files → ai/screens/", grouped(screens), screens.length);
  const used = INV.screens.filter((re) => screens.some((f) => re.test(f)));
  if (used.length) out.push(`  ui.include suggestion: ${JSON.stringify(used.map((re) => re.source).join("|"))}`);
  sec("API spec files → ui.api", hit("api").map((f) => `  ${f}`));
  const routes = hit("routes");
  sec("route files → ai/api/ when no API spec file", grouped(routes), routes.length);
  const decisions = hit("decisions");
  sec("decision docs → ai/decisions.md", decisions.map((f) => `  ${f}`));
  const plain = (f) => f.endsWith(".md") && !/(^|\/)(README|CHANGELOG|LICENSE|CLAUDE|AGENTS)\.md$/i.test(f) && !decisions.includes(f);
  const other = files.filter(plain);
  sec("other .md outside ai/ (requirements, decisions or human docs)", grouped(other), other.length);
  console.log(out.join("\n"));
}

const cmd = process.argv[2];
if (cmd === "init") init();
else if (cmd === "migrate") migrate();
else if (cmd === "inventory") inventory();
else if (cmd === "check") {
  const out = problems();
  out.forEach((p) => console.log(`ai-kit: ${p}`));
  memoryWarnings().forEach((w) => console.log(`! ai-kit: ${w}`));
  uiWarnings().forEach((w) => console.log(`! ai-kit: ${w}`));
  docsWarnings().forEach((w) => console.log(`! ai-kit: ${w}`));
  layoutWarnings().forEach((w) => console.log(`! ai-kit: ${w}`));
  if (out.length) process.exit(1);
} else {
  console.log("usage: node <plugin>/scripts/kit.mjs <init|check|migrate|inventory>");
  process.exit(2);
}
