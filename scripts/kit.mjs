// Wires the ai-kit plugin into a project, cwd in the project: node <plugin>/scripts/kit.mjs <command>
// Commands: README.md §Commands; migrate is in kit-migrate.mjs; `unattended`: docs/ai-layout.md §Runs without the plugin.
import { isMain } from "./lib/is-main.mjs";
import { allWarnings } from "./kit/check.mjs";
import { init, initFiles } from "./kit/init.mjs";
import { inventory } from "./kit/inventory.mjs";
import {
  HELPERS,
  IMPORT,
  PLUGIN,
  at,
  eolOf,
  isImportLine,
  isKitHook,
  isObj,
  jsonText,
  kit,
  lsFiles,
  read,
  readConf,
  root,
  tryGit,
} from "./kit/shared.mjs";
import { syncSnapshot } from "./kit/sync.mjs";
import { uninstall } from "./kit/uninstall.mjs";
import { unattended } from "./kit/unattended.mjs";

export {
  HELPERS,
  IMPORT,
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
  uninstall,
};

if (isMain(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "init") init();
  else if (cmd === "uninstall") uninstall(process.argv.slice(3));
  else if (cmd === "migrate") import("./kit-migrate.mjs").then((m) => m.migrate());
  else if (cmd === "inventory") inventory();
  else if (cmd === "check") {
    const { problems: out, warnings } = allWarnings();
    out.forEach((p) => console.log(`ai-kit: ${p}`));
    warnings.forEach((w) => console.log(`! ai-kit: ${w}`));
    if (out.length) process.exit(1);
  } else if (cmd === "unattended") unattended(process.argv.slice(3));
  else if (cmd === "sync") {
    const left = syncSnapshot(root, kit, readConf().conf);
    console.log(left === null ? "unattended is off" : left ? `${left} file(s) left, see above` : "in sync");
  } else {
    console.log(
      "usage: node <plugin>/scripts/kit.mjs <init|check|sync|unattended [--dry-run] [--force]|uninstall [--purge]|migrate|inventory>",
    );
    process.exit(2);
  }
}
