// True when the module with this import.meta.url is the script node was started with. import.meta.url is a realpath,
// process.argv[1] is not (a symlinked plugin root), so compare real paths. Every CLI guard uses this, never a raw
// compare against process.argv[1] (scripts/is-main.test.mjs greps for one).
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const isMain = (importMetaUrl) => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
};
