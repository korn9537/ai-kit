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
    desc: "a line left inside a removed fence is checked",
    head: { "docs/a.md": `one\n${B}\nin **bold**\n${B}\n` },
    work: { "docs/a.md": `one\nin **bold**\n${B}\n` },
    want: ["docs/a.md:2 bold"],
  },
  {
    desc: "status flip on a bold line passes",
    head: { "docs/a.md": "keep **x** here\n" },
    work: { "docs/a.md": "keep **x** here [done]\n" },
    want: [],
  },
  {
    desc: "a changed bold fragment is reported",
    head: { "docs/a.md": "keep **x** here\n" },
    work: { "docs/a.md": "keep **y** here\n" },
    want: ["docs/a.md:1 bold"],
  },
  {
    desc: "rename from an out-of-scope path is checked in full",
    head: { "README.md": "readme **b**\n" },
    run: [["mv", "README.md", "docs/r.md"]],
    want: ["docs/r.md:1 bold"],
  },
  {
    desc: "a delete-only hunk shifts later lines",
    head: { "docs/a.md": `x\n${B}\nin **bold**\n${B}\ntail\n` },
    work: { "docs/a.md": `${B}\nin **bold**\n${B}\n**tail**\n` },
    want: ["docs/a.md:4 bold"],
  },
  {
    desc: "a moved line passes",
    head: { "docs/a.md": "a\nkeep **x** here\nb\n" },
    work: { "docs/a.md": "a\nb\nkeep **x** here\n" },
    want: [],
  },
  {
    desc: "a copied line is reported",
    head: { "docs/a.md": "keep **x** here\n", "docs/b.md": "b\n" },
    work: { "docs/b.md": "b\nkeep **x** here\n" },
    want: ["docs/b.md:2 bold"],
  },
  {
    desc: "one removed line excuses one added copy",
    head: { "docs/a.md": "a\nkeep **x** here\nb\n" },
    work: { "docs/a.md": "a\nb\nkeep **x** here\n", "docs/b.md": "keep **x** here\nkeep **x** here\n" },
    want: ["docs/b.md:1 bold", "docs/b.md:2 bold"],
  },
  {
    desc: "a moved line takes its own file's removed copy before a copy elsewhere",
    head: { "docs/z.md": "a\nkeep **x** here\nb\n", "docs/a.md": "c\n" },
    work: { "docs/z.md": "a\nb\nkeep **x** here\n", "docs/a.md": "c\nkeep **x** here\n" },
    want: ["docs/a.md:2 bold"],
  },
  {
    desc: "HEAD text of paths with a space or non-ASCII name",
    head: { "docs/a b.md": `x\n${B}\n**in**\n${B}\n`, "docs/ไทย.md": `x\n${B}\n**in**\n${B}\n` },
    work: { "docs/a b.md": `x\n**in**\n${B}\n`, "docs/ไทย.md": `x\n${B}\n**in**\n${B}\n**new**\n` },
    want: ["docs/a b.md:2 bold", "docs/ไทย.md:5 bold"],
  },
  {
    desc: "vague quantities",
    head: { "docs/a.md": "x\n" },
    work: {
      "docs/a.md":
        "x\nabout 5 times\naround every 3 runs\nroughly hundred\nabout a dozen\nover ~40 KB\n" +
        "around 2026\nabout two-factor\nabout one of them\na note about two rules\n~/path\n",
    },
    want: ["docs/a.md:2 filler", "docs/a.md:3 filler", "docs/a.md:4 filler", "docs/a.md:5 filler", "docs/a.md:6 filler"],
  },
  {
    desc: "thai: quotes, code and table rows exempt",
    head: { "docs/a.md": "x\n" },
    work: { "docs/a.md": 'x\nสวัสดี\n"สวัสดี"\n`สวัสดี`\n| สวัสดี |\n' },
    want: ["docs/a.md:2 thai outside quotes"],
  },
  {
    desc: "an untracked doc is checked in full, an out-of-scope one not",
    head: { "docs/a.md": "x\n" },
    work: { "docs/new.md": "**n**\n", "README.md": "**n**\n" },
    want: ["docs/new.md:1 bold"],
  },
  {
    desc: "--staged reads the index",
    head: { "docs/a.md": "x\n" },
    work: { "docs/a.md": "x\n**staged**\n" },
    run: [["add", "-A"]],
    after: { "docs/a.md": "x\n**staged**\n**unstaged**\n" },
    args: ["--staged"],
    want: ["docs/a.md:2 bold"],
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
    mkdirSync(join(dir, "docs"));
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
