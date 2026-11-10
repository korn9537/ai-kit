// node <plugin>/scripts/kit.mjs migrate (kit.mjs dispatches here): turns a clean 1.x repo, the in-repo ai-kit/ copy,
// into a plugin one, then runs init and check. Kept for projects still on 1.x.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import {
  PLUGIN,
  allWarnings,
  at,
  eolOf,
  initFiles,
  isImportLine,
  isKitHook,
  isObj,
  jsonText,
  kit,
  lsFiles,
  read,
  root,
  tryGit,
} from "./kit.mjs";

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
const lexists = (p) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};


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

export function migrate() {
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

  const { problems: left, warnings } = allWarnings();
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
  [...left, ...warnings].forEach((p) => console.log(`! ${p}`));
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

if (isMain(import.meta.url)) migrate();
