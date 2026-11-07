// Tests for check-comments.mjs: each case writes `files` and `ai/kit/config.json`, then compares reported issues.
// Usage: node scripts/check-comments.test.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dirname, "check-comments.mjs");
const ALL = { comments: { include: "\\.(ts|py|sh|ya?ml)$" } };
const block = (p, n) => Array.from({ length: n }, (_, i) => `${p} note ${i}`).join("\n");

const CASES = [
  {
    desc: "a long // block is reported",
    files: { "a.ts": `${block("//", 3)}\nconst a = 1;\n` },
    want: ["a.ts:1 block of 3 lines"],
  },
  {
    desc: "a long /* */ block counts its * lines",
    files: { "a.ts": "/*\n * one\n * two\n */\nconst a = 1;\n" },
    want: ["a.ts:1 block of 4 lines"],
  },
  {
    desc: "a * line outside a block comment is code",
    files: { "a.ts": "call(\n  a,\n  *rest,\n  *more,\n  *last,\n);\n" },
    want: [],
  },
  {
    desc: "*args lines in a Python call are code",
    files: { "a.py": "f(\n    *args,\n    *rest,\n    *more,\n)\n" },
    want: [],
  },
  {
    desc: "a long # block in Python is reported",
    files: { "a.py": `x = 1\n${block("#", 3)}\ny = 2\n` },
    want: ["a.py:2 block of 3 lines"],
  },
  {
    desc: "a long # block in shell and YAML is reported",
    files: { "a.sh": `${block("#", 3)}\necho x\n`, "a.yml": `${block("#", 3)}\nk: v\n` },
    want: ["a.sh:1 block of 3 lines", "a.yml:1 block of 3 lines"],
  },
  {
    desc: "a shebang and tool directives are not comments",
    files: { "a.py": "#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\n# noqa: E501\nimport os\n" },
    want: [],
  },
  {
    desc: "a long docstring is reported, a one-line one is not",
    files: {
      "a.py": 'def f():\n    """One line."""\n    return 1\n\n\ndef g(\n    a,\n):\n    """First.\n\n    More.\n    """\n    return a\n',
    },
    want: ["a.py:9 block of 4 lines"],
  },
  {
    desc: "a multi-line string assigned to a name is code",
    files: { "a.py": 'SQL = """\nselect 1\nfrom t\nwhere x\n"""\n' },
    want: [],
  },
  {
    desc: "a string after a dict key is no docstring",
    files: { "a.py": 'd = {\n    "k":\n        """one\n        two\n        three""",\n}\n' },
    want: [],
  },
  {
    desc: "# lines in a shell heredoc and in a Python string are data",
    files: {
      "a.sh": `cat <<'EOF'\n${block("#", 3)}\nEOF\necho x\n`,
      "a.py": `SQL = """\n${block("#", 3)}\n"""\n`,
    },
    want: [],
  },
  {
    desc: "a here-string or a shift opens no heredoc",
    files: { "a.sh": `read a <<< hello\nx=$((1<<2))\n${block("#", 3)}\necho x\n` },
    want: ["a.sh:3 block of 3 lines"],
  },
  {
    desc: "a docstring after a signature ending in ) -> X: is checked",
    files: { "a.py": 'def f(\n    a, b) -> int:\n    """One.\n\n    Two.\n    """\n    return a\n' },
    want: ["a.py:3 block of 4 lines"],
  },
  {
    desc: "a shift inside (( )) opens no heredoc",
    files: { "a.sh": `(( m |= 1 << bit ))\n${block("#", 3)}\necho x\n` },
    want: ["a.sh:2 block of 3 lines"],
  },
  {
    desc: "a never-closed /* (inside a string) covers only its own line",
    files: { "a.ts": `const t = \`\n/* not a comment\n\`;\nconst a = 1;\n${block("//", 3)}\nconst b = 2;\n` },
    want: ["a.ts:5 block of 3 lines"],
  },
  {
    desc: "a /* line in a template literal opens no block, even with a JSDoc later",
    files: {
      "a.ts": "const t = `\n/* not a comment\n`;\nconst a = 1;\nconst b = 2;\nconst c = 3;\n/** One. */\nconst d = 4;\n",
    },
    want: [],
  },
  {
    desc: "a heredoc on a line with (( )) is still a heredoc",
    files: { "a.sh": `cat <<EOF | awk '{ print ((1)) }'\n${block("#", 3)}\nEOF\n` },
    want: [],
  },
  {
    desc: "history in a # comment is reported",
    files: { "a.py": "# this used to retry\nx = 1\n" },
    want: ["a.py:1 history"],
  },
  {
    desc: "present-tense used to, no longer than, until N, previously computed, ไม่เคย pass",
    files: {
      "a.ts":
        "// used to build the cache key\n\n// no longer than 40 chars\n\n// retry until 3 attempts\n\n// the previously computed value\n\n// ไม่เคยคืน null\n\n// is used to run the job\n",
    },
    want: [],
  },
  {
    desc: "history phrases are still reported",
    files: {
      "a.ts": "// used to be 2\n\n// previously this called foo\n\n// เคยคืน null\n\n// no longer retries\n",
    },
    want: ["a.ts:1 history", "a.ts:3 history", "a.ts:5 history", "a.ts:7 history"],
  },
  {
    desc: "real history with used to, until a version or year, an article before previously, Thai เดิม ... ไม่เคย",
    files: {
      "a.ts": [
        "// used to use redis",
        "// used to live in foo.ts",
        "// used to store the token here",
        "// used to crash on null",
        "// used to run migrations on boot",
        "// used to call the billing API",
        "// until v2.3 this was a string",
        "// until 2025 we sent both",
        "// the previously hardcoded limit moved to config",
        "// เดิมฟังก์ชันนี้ไม่เคยคืนค่า",
      ].join("\n\n") + "\n",
    },
    want: Array.from({ length: 10 }, (_, i) => `a.ts:${i * 2 + 1} history`).sort(),
  },
];

// --staged cases: `setup` runs in the repo after the files are staged
const STAGED = [
  {
    desc: "--staged reads the index: a dirty staged line is reported with a clean work tree",
    files: { "a.ts": "const a = 1;\n" },
    setup: (dir, git) => {
      writeFileSync(join(dir, "a.ts"), "// used to be bad 2026-01-01\nconst a = 1;\n");
      git("add", "a.ts");
      writeFileSync(join(dir, "a.ts"), "const a = 1;\n");
    },
    want: 1,
  },
  {
    desc: "--staged ignores a dirty work tree over a clean index",
    files: { "a.ts": "const a = 1;\n" },
    setup: (dir) => writeFileSync(join(dir, "a.ts"), "// used to be bad\nconst a = 1;\n"),
    want: 0,
  },
  {
    desc: "--staged checks a file staged but deleted from the work tree",
    files: { "a.ts": "// used to be bad\nconst a = 1;\n" },
    setup: (dir) => rmSync(join(dir, "a.ts")),
    want: 1,
  },
];

const put = (dir, files) => {
  for (const [p, body] of Object.entries(files ?? {})) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
};

let fail = 0;
for (const c of CASES) {
  const dir = mkdtempSync(join(tmpdir(), "check-comments-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  try {
    git("init", "-q");
    put(dir, { "ai/kit/config.json": JSON.stringify(ALL), ...c.files });
    git("add", "-A");
    const out = execFileSync("node", [SCRIPT], { cwd: dir, encoding: "utf8" });
    const got = out
      .split("\n")
      .map((l) => /^(.+?:\d+ [^:]+?)(:|$)/.exec(l)?.[1])
      .filter(Boolean)
      .sort();
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
for (const c of STAGED) {
  const dir = mkdtempSync(join(tmpdir(), "check-comments-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  try {
    git("init", "-q");
    put(dir, { "ai/kit/config.json": JSON.stringify(ALL), ...c.files });
    git("add", "-A");
    c.setup(dir, git);
    let rc = 0;
    try {
      execFileSync("node", [SCRIPT, "--staged", "--strict"], { cwd: dir, stdio: "pipe" });
    } catch (e) {
      rc = e.status;
    }
    const ok = rc === c.want;
    console.log(`${ok ? "ok  " : "FAIL"} - ${c.desc}`);
    if (!ok) fail++;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`\n${CASES.length + STAGED.length - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
