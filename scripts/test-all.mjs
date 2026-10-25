// Runs every hooks/*.test.sh, githooks/*.test.sh, scripts/*.test.mjs and scripts/check-wrap.mjs in parallel.
// Usage: node scripts/test-all.mjs; exit 1 when any suite fails.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const self = basename(fileURLToPath(import.meta.url));
const list = (dir, suffix) =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith(suffix) && f !== self)
    .sort()
    .map((f) => `${dir}/${f}`);

const suites = [
  ...list("hooks", ".test.sh").map((f) => ({ name: f, cmd: "bash", args: [f] })),
  ...list("githooks", ".test.sh").map((f) => ({ name: f, cmd: "bash", args: [f] })),
  ...list("scripts", ".test.mjs").map((f) => ({ name: f, cmd: process.execPath, args: [f] })),
  { name: "scripts/check-wrap.mjs", cmd: process.execPath, args: ["scripts/check-wrap.mjs"] },
];

const run = (s) =>
  new Promise((resolve) => {
    const child = spawn(s.cmd, s.args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => resolve({ ...s, code: 1, out: out + String(e) }));
    child.on("close", (code) => resolve({ ...s, code, out }));
  });

const start = Date.now();
const results = new Array(suites.length);
let next = 0;
const worker = async () => {
  while (next < suites.length) {
    const i = next++;
    results[i] = await run(suites[i]);
  }
};
await Promise.all(Array.from({ length: Math.min(availableParallelism(), suites.length) }, worker));

let failed = 0;
for (const r of results) {
  if (r.code === 0) {
    const last = r.out.split("\n").filter((l) => /\d+ passed, \d+ failed/.test(l)).pop() ?? "";
    console.log(`ok   ${r.name}  ${last.trim()}`.trimEnd());
  } else {
    failed++;
    console.log(`FAIL ${r.name}\n${r.out.trimEnd()}`);
  }
}
const secs = ((Date.now() - start) / 1000).toFixed(1);
console.log(`${results.length - failed} of ${results.length} suites ok, ${failed} failed (${secs} s)`);
process.exit(failed ? 1 : 0);
