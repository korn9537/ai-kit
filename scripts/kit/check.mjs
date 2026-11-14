// kit check: the warnings and problems a project is checked for; see scripts/kit.mjs
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { planWarnings } from "../plan.mjs";
import { transcriptsDir } from "../lib/usage-collect.mjs";
import { usageBufDir } from "../lib/state-dirs.mjs";
import { readSent, transcriptOf } from "../lib/usage-send.mjs";
import { MSG_SHIM, PLUGIN, SHIM, at, claudeDir, isObj, isShim, kit, lfMissing, lsFiles, msgShimPath, notExecutable, ownHooksPath, read, readConf, readLF, root, shimPath, tryGit, tryGitIn } from "./shared.mjs";
import { snapshotWarnings } from "./sync.mjs";

// Claude Code's auto-memory dir: main worktree path, non-alphanumerics -> '-' (hooks/lib.sh too); a long path's
// hashed slug and autoMemoryDirectory are not followed, so a miss only skips the warning
const memoryDir = () => join(transcriptsDir(root), "memory");

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

function eolWarnings() {
  return lfMissing().map(
    (r) =>
      `${r.sample} has no eol=lf attribute, so a Windows checkout gets CRLF and sh fails on it (fix: node <plugin>/scripts/kit.mjs init adds "${r.line}" to .gitattributes)`,
  );
}

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

function docsWarnings(conf) {
  return conf?.docs?.include === OLD_DOCS_INCLUDE
    ? [
        `ai/kit/config.json docs.include still checks docs/ and CLAUDE.md, which the AI-only doc rule no longer governs (fix: set "include": ${JSON.stringify("^ai/.*\\.md$")})`,
      ]
    : [];
}

// usage left in the repo (tracked or untracked under ai/usage/), sessions whose send keeps failing or the server
// refused; offline, file times and the buffer's own files only
function usageWarnings() {
  const out = [];
  const left = ["ls-files", "ls-files --others --exclude-standard"]
    .flatMap((a) => (tryGitIn(root, [...a.split(" "), "-z", "--", "ai/usage"]) ?? "").split("\0"))
    .filter(Boolean);
  if (left.length) {
    out.push(
      `ai/usage/ still holds ${new Set(left).size} file(s), but usage now goes to the usage server (fix: node <plugin>/scripts/usage.mjs migrate posts them and stages their removal, then commit)`,
    );
  }
  const buf = usageBufDir(root);
  const day = Date.now() - 864e5;
  let names = [];
  try {
    names = readdirSync(buf).filter((n) => n.endsWith(".transcript"));
  } catch {
    // no buffer yet: nothing recorded
  }
  // a session whose transcript is gone has nothing left to send
  const live = names.map((n) => n.slice(0, -".transcript".length)).filter((id) => {
    const t = transcriptOf(buf, id);
    return t && existsSync(t);
  });
  const stale = live.filter((id) => {
    const t = statSync(join(buf, `${id}.transcript`), { throwIfNoEntry: false })?.mtimeMs ?? Infinity;
    const sent = statSync(join(buf, `${id}.sent`), { throwIfNoEntry: false })?.mtimeMs ?? 0;
    return t < day && sent < t;
  });
  if (stale.length) {
    out.push(
      `${stale.length} session(s) have usage not sent for over a day (a send is retried at a session start once the session has been idle 6 h; send now: node <plugin>/scripts/usage.mjs send --session ${stale[0]}; failures are in ${join(buf, "send.log")})`,
    );
  }
  const rejected = live.filter((id) => readSent(buf, id)?.rejected);
  if (rejected.length) {
    out.push(
      `${rejected.length} session(s) refused by the usage server (HTTP 4xx), not sent again until the transcript grows: ${rejected.slice(0, 3).join(", ")} (error in ${join(buf, `${rejected[0]}.sent`)} and ${join(buf, "send.log")})`,
    );
  }
  return out;
}

// top-level entries of ai/ (docs/ai-layout.md); a path ui.api or analysis-sources.md names is allowed too
const AI_LAYOUT = ["kit", "decisions.md", "requirements", "data", "specs", "screens", "api", "plans", "notes.md", "usage"];

function layoutWarnings(conf) {
  let ents;
  try {
    ents = readdirSync(at("ai")).filter((e) => !e.startsWith("."));
  } catch {
    return [];
  }
  const api = conf?.ui?.api;
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

// warning, not a problem: a project before 2.23.0 must keep committing (docs/shared-checkout.md §Jobs)
function jobWarnings() {
  const shim = read(msgShimPath);
  if (shim === null)
    return [
      ".githooks/commit-msg is missing, so commits carry no Job: trailer check (fix: node <plugin>/scripts/kit.mjs init; the plugin's docs/shared-checkout.md §Jobs)",
    ];
  if (!isShim(shim))
    return [
      ".githooks/commit-msg is not the ai-kit shim (fix: move its checks elsewhere, delete it, then run init)",
    ];
  if (notExecutable(msgShimPath))
    return [".githooks/commit-msg is not executable, so git skips it (fix: node <plugin>/scripts/kit.mjs init)"];
  return [];
}

// init rewrites a kit shim whose text differs; an older one passes silently once a plugin update removes its version.
// Line endings are eolWarnings' part; a pre-commit shim with no range is snapshotWarnings' when unattended is on
function shimWarnings(conf) {
  const old = [];
  const pre = readLF(shimPath);
  const named = conf?.unattended === true && !pre?.includes("AI_KIT_RANGE=");
  if (pre !== null && isShim(pre) && pre !== SHIM && !named) old.push("pre-commit");
  const msg = readLF(msgShimPath);
  if (msg !== null && isShim(msg) && msg !== MSG_SHIM) old.push("commit-msg");
  return old.map((h) => `.githooks/${h} is an older ai-kit shim (fix: node <plugin>/scripts/kit.mjs init rewrites it)`);
}

// warnings, not problems: a UI project before 2.8.0 must keep committing (docs/screen-specs.md)
function uiWarnings(conf) {
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

function problems({ text, conf, error }) {
  const out = [];
  if (text === null)
    out.push(
      "ai/kit/config.json is missing (fix: node <plugin>/scripts/kit.mjs init, or /ai-kit:init)",
    );
  else {
    if (error)
      out.push(
        `ai/kit/config.json is not valid JSON (fix: correct the syntax; ${error.message})`,
      );
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
  else if (!isShim(shim))
    out.push(
      ".githooks/pre-commit is not the ai-kit shim (fix: move its checks into ai/kit/pre-commit.sh, delete it, then run init)",
    );
  else if (notExecutable(shimPath))
    out.push(".githooks/pre-commit is not executable, so git skips it (fix: node <plugin>/scripts/kit.mjs init)");
  const hp = tryGit("config", "core.hooksPath") ?? "";
  if (!ownHooksPath(hp))
    out.push(
      `core.hooksPath is ${hp || "unset"}, not .githooks, so the kit pre-commit never runs (fix: git config core.hooksPath .githooks; if ${hp ? "that path holds other hooks" : "other hooks need it"}, move them into ai/kit/pre-commit.sh first)`,
    );

  // Claude Code applies the highest scope that sets the plugin: local, then project, then user
  const scopes = [
    at(".claude", "settings.local.json"),
    at(".claude", "settings.json"),
    join(claudeDir(), "settings.json"),
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
  for (const a of ["business-analyst.md", "change-reviewer.md"])
    if (existsSync(at(".claude", "agents", a)))
      out.push(
        `.claude/agents/${a} is an old kit copy that shadows the plugin agent (fix: delete it)`,
      );
  return out;
}

// every problem and warning of check, in one place so init and check cannot drift apart; c is the config
// read by readConf, taken once per run
function allWarnings(c = readConf()) {
  const conf = c.conf ?? null;
  return {
    problems: problems(c),
    warnings: [
      ...memoryWarnings(),
      ...eolWarnings(),
      ...jobWarnings(),
      ...shimWarnings(conf),
      ...uiWarnings(conf),
      ...docsWarnings(conf),
      ...layoutWarnings(conf),
      ...planWarnings(root),
      ...snapshotWarnings(root, kit, conf),
      ...usageWarnings(),
    ],
  };
}

export { allWarnings, detectUi, layoutWarnings };
