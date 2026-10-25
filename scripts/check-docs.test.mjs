// Tests for check-docs.mjs: each case commits `head`, applies `work` (and `run`), then compares reported issues.
// Usage: node scripts/check-docs.test.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dirname, "check-docs.mjs");
const B = "```";

const CASES = [
  {
    desc: "files outside ai/ are not checked by default",
    head: { "docs/a.md": "a\n", "CLAUDE.md": "c\n" },
    work: { "docs/a.md": "a **bold**\n", "CLAUDE.md": "c **bold**\n" },
    want: [],
  },
  {
    desc: "a line left inside a removed fence is checked",
    head: { "ai/a.md": `one\n${B}\nin **bold**\n${B}\n` },
    work: { "ai/a.md": `one\nin **bold**\n${B}\n` },
    want: ["ai/a.md:2 bold"],
  },
  {
    desc: "status flip on a bold line passes",
    head: { "ai/a.md": "keep **x** here\n" },
    work: { "ai/a.md": "keep **x** here [done]\n" },
    want: [],
  },
  {
    desc: "a changed bold fragment is reported",
    head: { "ai/a.md": "keep **x** here\n" },
    work: { "ai/a.md": "keep **y** here\n" },
    want: ["ai/a.md:1 bold"],
  },
  {
    desc: "rename from an out-of-scope path is checked in full",
    head: { "README.md": "readme **b**\n" },
    run: [["mv", "README.md", "ai/r.md"]],
    want: ["ai/r.md:1 bold"],
  },
  {
    desc: "a delete-only hunk shifts later lines",
    head: { "ai/a.md": `x\n${B}\nin **bold**\n${B}\ntail\n` },
    work: { "ai/a.md": `${B}\nin **bold**\n${B}\n**tail**\n` },
    want: ["ai/a.md:4 bold"],
  },
  {
    desc: "a moved line passes",
    head: { "ai/a.md": "a\nkeep **x** here\nb\n" },
    work: { "ai/a.md": "a\nb\nkeep **x** here\n" },
    want: [],
  },
  {
    desc: "a copied line is reported",
    head: { "ai/a.md": "keep **x** here\n", "ai/b.md": "b\n" },
    work: { "ai/b.md": "b\nkeep **x** here\n" },
    want: ["ai/b.md:2 bold"],
  },
  {
    desc: "one removed line excuses one added copy",
    head: { "ai/a.md": "a\nkeep **x** here\nb\n" },
    work: { "ai/a.md": "a\nb\nkeep **x** here\n", "ai/b.md": "keep **x** here\nkeep **x** here\n" },
    want: ["ai/b.md:1 bold", "ai/b.md:2 bold"],
  },
  {
    desc: "a moved line takes its own file's removed copy before a copy elsewhere",
    head: { "ai/z.md": "a\nkeep **x** here\nb\n", "ai/a.md": "c\n" },
    work: { "ai/z.md": "a\nb\nkeep **x** here\n", "ai/a.md": "c\nkeep **x** here\n" },
    want: ["ai/a.md:2 bold"],
  },
  {
    desc: "HEAD text of paths with a space or non-ASCII name",
    head: { "ai/a b.md": `x\n${B}\n**in**\n${B}\n`, "ai/ไทย.md": `x\n${B}\n**in**\n${B}\n` },
    work: { "ai/a b.md": `x\n**in**\n${B}\n`, "ai/ไทย.md": `x\n${B}\n**in**\n${B}\n**new**\n` },
    want: ["ai/a b.md:2 bold", "ai/ไทย.md:5 bold"],
  },
  {
    desc: "vague quantities",
    head: { "ai/a.md": "x\n" },
    work: {
      "ai/a.md":
        "x\nabout 5 times\naround every 3 runs\nroughly hundred\nabout a dozen\nover ~40 KB\n" +
        "around 2026\nabout two-factor\nabout one of them\na note about two rules\n~/path\n",
    },
    want: ["ai/a.md:2 filler", "ai/a.md:3 filler", "ai/a.md:4 filler", "ai/a.md:5 filler", "ai/a.md:6 filler"],
  },
  {
    desc: "thai: quotes, code and table rows exempt",
    head: { "ai/a.md": "x\n" },
    work: { "ai/a.md": 'x\nสวัสดี\n"สวัสดี"\n`สวัสดี`\n| สวัสดี |\n' },
    want: ["ai/a.md:2 thai outside quotes"],
  },
  {
    desc: "line pointer: code file with a line, code spans included; hosts, symbols and doc sections pass",
    head: { "ai/a.md": "x\n" },
    work: {
      "ai/a.md":
        "x\n`src/a.service.ts:12`\nsee b.dart:3-9.\nredis.local:6379 · 127.0.0.1:5432 · http://x.io:8080/a.ts\n" +
        "`orders.service.ts` `approveOrder` · → ai/specs/x.md §3\n",
    },
    want: ["ai/a.md:2 line pointer", "ai/a.md:3 line pointer"],
  },
  {
    desc: "line pointer kept on an edited line passes",
    head: { "ai/a.md": "see `a.ts:4` for x\n" },
    work: { "ai/a.md": "see `a.ts:4` for y\n" },
    want: [],
  },
  {
    desc: "an untracked doc is checked in full, an out-of-scope one not",
    head: { "ai/a.md": "x\n" },
    work: { "ai/new.md": "**n**\n", "README.md": "**n**\n" },
    want: ["ai/new.md:1 bold"],
  },
  {
    desc: "--staged reads the index",
    head: { "ai/a.md": "x\n" },
    work: { "ai/a.md": "x\n**staged**\n" },
    run: [["add", "-A"]],
    after: { "ai/a.md": "x\n**staged**\n**unstaged**\n" },
    args: ["--staged"],
    want: ["ai/a.md:2 bold"],
  },
];

const put = (dir, files) => {
  for (const [p, t] of Object.entries(files ?? {})) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), t);
  }
};

let fail = 0;
for (const c of CASES) {
  const dir = mkdtempSync(join(tmpdir(), "check-docs-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(dir, "ai"));
    put(dir, c.head);
    git("add", "-A");
    git("commit", "-qm", "head");
    put(dir, c.work);
    for (const r of c.run ?? []) git(...r);
    put(dir, c.after);
    const out = execFileSync("node", [SCRIPT, ...(c.args ?? [])], { cwd: dir, encoding: "utf8" });
    const got = out
      .split("\n")
      .map((l) => /^(.+?:\d+ [^:]+):/.exec(l)?.[1])
      .filter(Boolean);
    const ok = JSON.stringify(got) === JSON.stringify(c.want);
    console.log(`${ok ? "ok  " : "FAIL"} - ${c.desc}`);
    if (!ok) {
      fail++;
      console.log(`       want ${JSON.stringify(c.want)}\n       got  ${JSON.stringify(got)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`\n${CASES.length - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
