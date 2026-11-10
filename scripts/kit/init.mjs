// kit init: what a project is wired with; see scripts/kit.mjs
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { syncSnapshot } from "./sync.mjs";
import { MARK, MSG_SHIM, SHIM, at, eolOf, isObj, isShim, jsonText, kit, lfMissing, msgShimPath, notExecutable, ownHooksPath, read, readConf, root, shimPath, tryGit } from "./shared.mjs";
import { allWarnings } from "./check.mjs";

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
  } else if (!isShim(shim))
    console.log(
      "! .githooks/pre-commit exists and does not run the kit: move its checks into ai/kit/pre-commit.sh, delete it, then rerun init",
    );
  else if (shim !== SHIM) {
    writeFileSync(shimPath, SHIM, { mode: 0o755 });
    console.log("~ .githooks/pre-commit (shim updated)");
  }
  const msgShim = read(msgShimPath);
  if (msgShim === null) {
    mkdirSync(at(".githooks"), { recursive: true });
    writeFileSync(msgShimPath, MSG_SHIM, { mode: 0o755 });
    created.push(".githooks/commit-msg");
    console.log("+ .githooks/commit-msg");
  } else if (!isShim(msgShim))
    console.log(
      "! .githooks/commit-msg exists and does not run the kit: move its checks elsewhere, delete it, then rerun init",
    );
  else if (msgShim !== MSG_SHIM) {
    writeFileSync(msgShimPath, MSG_SHIM, { mode: 0o755 });
    console.log("~ .githooks/commit-msg (shim updated)");
  }

  for (const [p, rel] of [[shimPath, ".githooks/pre-commit"], [msgShimPath, ".githooks/commit-msg"]])
    if (isShim(read(p)) && notExecutable(p)) {
      chmodSync(p, 0o755);
      console.log(`~ ${rel} (made executable)`);
    }

  // another hooks path (husky) would be switched off silently: leave it to the user
  const hp = tryGit("config", "core.hooksPath") ?? "";
  if (hp && !ownHooksPath(hp))
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

  // outside a git repo check-attr fails: nothing to add
  const lf = tryGit("rev-parse", "--git-dir") === null ? [] : lfMissing();
  if (lf.length) {
    const gp = at(".gitattributes");
    const gt = read(gp);
    const eol = gt ? eolOf(gt) : "\n";
    const lead = gt && !gt.endsWith("\n") ? eol : "";
    writeFileSync(gp, (gt ?? "") + lead + lf.map((r) => r.line).join(eol) + eol);
    if (gt === null) created.push(".gitattributes");
    console.log(`~ .gitattributes (${lf.map((r) => r.line).join(", ")})`);
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
  const c = readConf();
  syncSnapshot(root, kit, c.conf);
  const left = allWarnings(c);
  [...left.problems, ...left.warnings].forEach((p) => console.log(`! ${p}`));
  console.log(left.problems.length ? "init done; problems above" : "ai-kit ready");
  console.log(
    "restart the Claude Code session so the SessionStart hook injects the working conventions",
  );
}

export { init, initFiles };
