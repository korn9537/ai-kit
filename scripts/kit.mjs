// Wires the ai-kit plugin into a project: node <plugin>/scripts/kit.mjs <init|check|migrate>, cwd in the project.
// What each command does: README.md §Commands.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
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
const writeJson = (p, o) => writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`);
const isKitHook = (h) => (h?.command ?? "").includes("ai-kit/hooks/");

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

function fail(msg) {
  console.log(`ai-kit migrate: ${msg}`);
  process.exit(1);
}

function migrate() {
  const status = tryGit("status", "--porcelain");
  if (status === null) fail("not inside a git repo");
  if (status)
    fail(
      "the working tree has changes; commit or stash them first, so the migration is its own diff",
    );

  const settingsP = at(".claude", "settings.json");
  const localP = at(".claude", "settings.local.json");
  const settings = {};
  for (const p of [settingsP, localP]) {
    const t = read(p);
    if (t === null) continue;
    try {
      settings[p] = JSON.parse(t) ?? {};
    } catch (e) {
      fail(`${p} is not valid JSON; fix it first (${e.message})`);
    }
  }
  const kitDir = at("ai-kit");
  const claudeMd = read(at("CLAUDE.md"));
  const hasImport =
    claudeMd?.split("\n").some((l) => l.trim() === IMPORT) ?? false;
  const hasHooks = Object.values(settings).some((s) =>
    stripKitHooks(structuredClone(s)),
  );
  if (!existsSync(kitDir) && !hasHooks && !hasImport)
    fail(
      "nothing from ai-kit 1.x here (no ai-kit/, no ai-kit/hooks/ entries in settings, no @ai-kit import); run init instead",
    );
  if (
    existsSync(kitDir) &&
    !["sync.mjs", "CLAUDE.core.md"].some((f) => existsSync(join(kitDir, f)))
  )
    fail(
      "ai-kit/ has neither sync.mjs nor CLAUDE.core.md, so it may not be the kit; move or delete it by hand, then rerun",
    );

  const deleted = [];
  const changed = [];
  const byHand = [];

  if (existsSync(kitDir)) {
    rmSync(kitDir, { recursive: true, force: true });
    deleted.push("ai-kit/");
  }
  for (const a of ["business-analyst.md", "change-reviewer.md"])
    if (existsSync(at(".claude", "agents", a))) {
      rmSync(at(".claude", "agents", a));
      deleted.push(`.claude/agents/${a}`);
    }
  const agentsDir = at(".claude", "agents");
  if (existsSync(agentsDir) && !readdirSync(agentsDir).length)
    rmdirSync(agentsDir);

  for (const [p, s] of Object.entries(settings))
    if (p !== settingsP && stripKitHooks(s)) {
      writeJson(p, s);
      changed.push(".claude/settings.local.json");
    }
  const s = settings[settingsP] ?? {};
  stripKitHooks(s);
  s.extraKnownMarketplaces = {
    ...(s.extraKnownMarketplaces ?? {}),
    korn9537: {
      source: { source: "github", repo: "korn9537/ai-kit" },
      autoUpdate: true,
    },
  };
  s.enabledPlugins = { ...(s.enabledPlugins ?? {}), [PLUGIN]: true };
  mkdirSync(at(".claude"), { recursive: true });
  writeJson(settingsP, s);
  changed.push(".claude/settings.json");

  if (hasImport) {
    const lines = claudeMd.split("\n");
    const i = lines.findIndex((l) => l.trim() === IMPORT);
    lines.splice(i, 1);
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
    writeFileSync(at("CLAUDE.md"), `${lines.join("\n").replace(/\s+$/, "")}\n`);
    changed.push("CLAUDE.md");
  }

  const confP = at("ai", "kit", "config.json");
  const confText = read(confP);
  let conf = null;
  try {
    conf = confText === null ? null : JSON.parse(confText);
  } catch {
    byHand.push("ai/kit/config.json is not valid JSON; fix it by hand");
  }
  if (conf && typeof conf === "object" && !Array.isArray(conf)) {
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
        .replace(/\n\s*"shared_checkout_doc"\s*:\s*"ai-kit\/[^"]*"\s*,/, "")
        .replace(/,\s*"shared_checkout_doc"\s*:\s*"ai-kit\/[^"]*"(?=\s*\})/, "");
      let ok = false;
      try {
        ok = JSON.stringify(JSON.parse(text)) === JSON.stringify(want);
      } catch {}
      if (ok) writeFileSync(confP, text);
      else writeJson(confP, want);
      changed.push("ai/kit/config.json");
    }
  }

  const kitFiles = existsSync(at("ai", "kit"))
    ? readdirSync(at("ai", "kit")).filter((f) => /\.(sh|md)$/.test(f))
    : [];
  for (const f of kitFiles) {
    const p = at("ai", "kit", f);
    const lines = read(p).split("\n");
    let n = 0;
    lines.forEach((l, i) => {
      if (Object.hasOwn(OLD_HEADERS, l)) {
        lines[i] = OLD_HEADERS[l];
        n++;
      }
    });
    if (n) {
      writeFileSync(p, lines.join("\n"));
      changed.push(`ai/kit/${f}`);
    }
  }
  for (const f of [
    "CLAUDE.md",
    ...kitFiles.map((f) => `ai/kit/${f}`),
    "ai/kit/config.json",
  ])
    (read(at(f)) ?? "").split("\n").forEach((l, i) => {
      if (l.includes("ai-kit/")) byHand.push(`${f}:${i + 1}: ${l.trim()}`);
    });

  console.log("ai-kit migrate: running init");
  init();
  const left = problems();

  console.log("\nai-kit migrate summary");
  deleted.forEach((d) => console.log(`- deleted ${d}`));
  changed.forEach((c) => console.log(`~ changed ${c}`));
  if (byHand.length) {
    console.log("review by hand (still cites the 1.x in-repo ai-kit/):");
    byHand.forEach((b) => console.log(`  ${b}`));
  }
  console.log(
    left.length
      ? `check: ${left.length} problem(s), listed above`
      : "check: passed",
  );
  const staged = [...deleted, ...changed, ".githooks/pre-commit"]
    .filter((f) => !f.endsWith("settings.local.json"))
    .join(" ");
  console.log(`next steps:
  1. review git status and git diff
  2. stage by name (git add -- ${staged}, plus any new ai/kit/ file listed above), then commit
  3. open Claude Code in the repo, trust the folder so it installs the plugin, and restart the session`);
  if (left.length) process.exit(1);
}

const cmd = process.argv[2];
if (cmd === "init") init();
else if (cmd === "migrate") migrate();
else if (cmd === "check") {
  const out = problems();
  out.forEach((p) => console.log(`ai-kit: ${p}`));
  if (out.length) process.exit(1);
} else {
  console.log("usage: node <plugin>/scripts/kit.mjs <init|check|migrate>");
  process.exit(2);
}
