// Tests for is-main.mjs: each CLI runs through a symlinked path, and no script compares process.argv[1] by hand.
// Usage: node scripts/is-main.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;
const ok = (desc, cond, extra = "") => {
  if (cond) {
    passed++;
    console.log(`ok   - ${desc}`);
  } else {
    failed++;
    console.log(`FAIL - ${desc} ${extra}`);
  }
};

const dir = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "is-main-"));
try {
  const link = join(tmp, "scripts");
  symlinkSync(dir, link);
  // No-arg runs print a usage line on stderr and exit non-zero when the guard fires; a silent run means it did not.
  for (const [name, args] of [["usage", []], ["plan", []], ["continuous", []], ["decider", ["bogus"]], ["kit", ["bogus"]]]) {
    const r = spawnSync(process.execPath, [join(link, `${name}.mjs`), ...args], { encoding: "utf8", input: "", cwd: tmp });
    ok(`${name}.mjs runs its CLI through a symlinked path`, /usage|error/i.test(r.stderr + r.stdout), JSON.stringify(r.stderr));
  }
  const bad = readdirSync(dir)
    .filter((f) => f.endsWith(".mjs") && f !== "is-main.mjs" && !f.endsWith(".test.mjs"))
    .filter((f) => /process\.argv\[1\]/.test(readFileSync(join(dir, f), "utf8")));
  ok("no script uses process.argv[1] outside is-main.mjs", bad.length === 0, bad.join(","));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
