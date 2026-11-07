// Tests for check-size.mjs: each case commits a 115 KB file, stages an edit, then compares the exit code.
// Usage: node scripts/check-size.test.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dirname, "check-size.mjs");
const BIG = Array.from({ length: 3000 }, (_, i) => `const value${i} = compute(${i}, "padding padding");`).join("\n") + "\n";

const CASES = [
  {
    desc: "a new code line in a big file is blocked",
    edit: (dir) => writeFileSync(join(dir, "a.ts"), `${BIG}const added = 1;\n`),
    want: 1,
  },
  {
    desc: "a git mv of a big file plus a new line is blocked",
    edit: (dir, git) => {
      git("mv", "a.ts", "b.ts");
      writeFileSync(join(dir, "b.ts"), `${BIG}const added = 1;\n`);
    },
    want: 1,
  },
  {
    desc: "a pure git mv of a big file passes",
    edit: (dir, git) => git("mv", "a.ts", "b.ts"),
    want: 0,
  },
  {
    desc: "an export { } block of wiring passes",
    edit: (dir) => writeFileSync(join(dir, "a.ts"), `${BIG}export {\n  a,\n  b,\n};\n`),
    want: 0,
  },
  {
    desc: "code after the }; of an export block is blocked",
    edit: (dir) => writeFileSync(join(dir, "a.ts"), `${BIG}export {\n  a,\n};\nexport function evil() {}\n`),
    want: 1,
  },
];

let fail = 0;
for (const c of CASES) {
  const dir = mkdtempSync(join(tmpdir(), "check-size-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    writeFileSync(join(dir, "a.ts"), BIG);
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    c.edit(dir, git);
    git("add", "-A");
    let rc = 0;
    try {
      execFileSync("node", [SCRIPT], { cwd: dir, stdio: "pipe" });
    } catch (e) {
      rc = e.status;
    }
    const ok = rc === c.want;
    console.log(`${ok ? "ok  " : "FAIL"} - ${c.desc}`);
    if (!ok) {
      fail++;
      console.log(`       want rc ${c.want}, got ${rc}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`\n${CASES.length - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
