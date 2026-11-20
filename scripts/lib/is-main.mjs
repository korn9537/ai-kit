// True when the module with this import.meta.url is node's entry script, compared by real path (argv[1] may be a
// symlink); every CLI guard uses this, never a raw argv[1] compare (scripts/is-main.test.mjs greps for one)
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const isMain = (importMetaUrl) => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
};
