// Tests for is-main.mjs: each CLI runs through a symlinked path, and no script compares process.argv[1] by hand.
// Also: every child_process call in scripts/ passes windowsHide (a detached send has no console, so on Windows each
// git it runs would open a terminal window).
// Usage: node scripts/is-main.test.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
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
  const scanned = [dir, join(dir, "kit"), join(dir, "lib")].flatMap((d) => (existsSync(d) ? readdirSync(d).map((f) => join(d, f)) : []));
  const bad = scanned
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && !f.endsWith("is-main.mjs"))
    .filter((f) => /process\.argv\[1\]/.test(readFileSync(f, "utf8")));
  ok("no script uses process.argv[1] outside is-main.mjs", bad.length === 0, bad.join(","));
  // the call's argument text, up to its closing paren; strings are skipped so a ")" inside one does not end it. No
  // closing paren (a quote in a regex literal ran the skip off) gives "", so the call fails instead of passing
  const callArgs = (t, open) => {
    let depth = 0;
    for (let i = open; i < t.length; i++) {
      const c = t[i];
      if (c === '"' || c === "'" || c === "`") {
        for (i++; i < t.length && t[i] !== c; i++) if (t[i] === "\\") i++;
      } else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return t.slice(open, i + 1);
    }
    return "";
  };
  const shown = scanned
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .flatMap((f) => {
      const t = readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "");
      return [...t.matchAll(/(?<![.\w])(?:execFileSync|execSync|spawnSync|spawn|execFile|exec)\(/g)]
        .filter((m) => !/windowsHide:\s*true\b/.test(callArgs(t, m.index + m[0].length - 1)))
        .map((m) => `${f.slice(dir.length + 1)}:${t.slice(0, m.index).split("\n").length}`);
    });
  ok("every child_process call in scripts/ passes windowsHide", shown.length === 0, shown.join(","));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
