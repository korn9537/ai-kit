// kit uninstall: removes what init wired; see scripts/kit.mjs
import {
  existsSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { LINE, MARK, PLUGIN, at, eolOf, isObj, isShim, jsonText, msgShimPath, ownHooksPath, read, shimPath, tryGit } from "./shared.mjs";

// reverses initFiles() and the plugin flag; never touches user scope (~/.claude/settings.json) or ai/kit/ content
// unless --purge. Left-as-is files (a hook that is not the kit shim, .githooks/ still used by another hook) are
// reported, not forced.
function uninstall(args = []) {
  const purge = args.includes("--purge");
  const left = [];

  for (const [p, rel] of [[shimPath, ".githooks/pre-commit"], [msgShimPath, ".githooks/commit-msg"]]) {
    const s = read(p);
    if (s === null) continue;
    if (isShim(s)) {
      rmSync(p);
      console.log(`- ${rel}`);
    } else left.push(`${rel} is not the ai-kit shim, left as it is`);
  }
  const hooksDir = at(".githooks");
  if (existsSync(hooksDir) && readdirSync(hooksDir).length === 0) {
    rmSync(hooksDir, { recursive: true });
    console.log("- .githooks/");
  }

  const hp = tryGit("config", "core.hooksPath") ?? "";
  if (ownHooksPath(hp)) {
    if (!existsSync(hooksDir)) {
      tryGit("config", "--unset", "core.hooksPath");
      console.log("~ core.hooksPath (unset)");
    } else left.push("core.hooksPath left as .githooks: other file(s) remain in .githooks/");
  }

  const cp = at("CLAUDE.md");
  const claude = read(cp);
  if (claude !== null && claude.split(/\r?\n/).some((l) => l.trim() === LINE)) {
    const eol = eolOf(claude);
    const kept = [];
    for (const l of claude.split(/\r\n|\n/)) {
      if (l.trim() === LINE) {
        if (kept.length && kept[kept.length - 1] === "") kept.pop();
        continue;
      }
      kept.push(l);
    }
    while (kept.length && kept[kept.length - 1] === "") kept.pop();
    writeFileSync(cp, kept.length ? kept.join(eol) + eol : "");
    console.log("~ CLAUDE.md (pointer line removed)");
  }

  const common = tryGit("rev-parse", "--path-format=absolute", "--git-common-dir");
  if (common) {
    const mp = join(common, MARK);
    if (existsSync(mp)) {
      rmSync(mp);
      console.log(`- ${mp}`);
    }
  }

  // project scope only; a user-scope (~/.claude/settings.json) entry is the user's, as check() already treats it
  for (const f of ["settings.local.json", "settings.json"]) {
    const sp = at(".claude", f);
    const st = read(sp);
    if (st === null) continue;
    let sj;
    try {
      sj = JSON.parse(st);
    } catch {
      continue;
    }
    if (isObj(sj) && isObj(sj.enabledPlugins) && Object.hasOwn(sj.enabledPlugins, PLUGIN)) {
      delete sj.enabledPlugins[PLUGIN];
      if (Object.keys(sj.enabledPlugins).length === 0) delete sj.enabledPlugins;
      writeFileSync(sp, jsonText(sj, eolOf(st)));
      console.log(`~ .claude/${f} (${PLUGIN} removed from enabledPlugins)`);
    }
  }

  if (existsSync(at("ai", "kit"))) {
    if (purge) {
      rmSync(at("ai", "kit"), { recursive: true });
      console.log("- ai/kit/");
    } else console.log("ai/kit/ left as it is (rerun with --purge to delete it too)");
  }

  left.forEach((l) => console.log(`! ai-kit: ${l}`));
  console.log(
    left.length ? "uninstalled with item(s) left, see above" : "ai-kit uninstalled; restart the Claude Code session",
  );
  if (left.length) process.exitCode = 1;
}

export { uninstall };
