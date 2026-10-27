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
    desc: "history in a # comment is reported",
    files: { "a.py": "# this used to retry\nx = 1\n" },
    want: ["a.py:1 history"],
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
console.log(`\n${CASES.length - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
