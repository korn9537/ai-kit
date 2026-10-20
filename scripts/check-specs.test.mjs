// Tests for check-specs.mjs: each case commits `head`, writes `work`, stages `stage`, then compares `!` lines.
// Usage: node scripts/check-specs.test.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dirname, "check-specs.mjs");
const conf = (ui) => JSON.stringify({ ui });
const UI = conf({ platforms: ["web"], include: "^app/.*/page\\.tsx$", api: "ai/api/" });
const idx = (...ids) => ids.map((i) => `- ${i} x\n`).join("");
const scr = (id, body) => `# ${id} Name\n\n${body}`;
const API_MD = "# API orders\n\n## GET /screens/order-list\n\n## POST /orders/{id}/approve\n";

const CASES = [
  {
    desc: "off without ui.platforms",
    head: { "ai/kit/config.json": conf({ platforms: [] }), "ai/screens/bad.md": "x\n" },
    want: [],
  },
  {
    desc: "known endpoints pass, params normalized",
    head: {
      "ai/kit/config.json": UI,
      "ai/api/orders.md": API_MD,
      "ai/screens/index.md": idx("S-1"),
      "ai/screens/S-1-orders.md": scr("S-1", "reads: GET /screens/order-list?status=\nactions: approve → POST /orders/{orderId}/approve\n"),
    },
    want: [],
  },
  {
    desc: "unknown endpoint and a second read are reported; lookups and fences are not",
    head: {
      "ai/kit/config.json": UI,
      "ai/api/orders.md": API_MD,
      "ai/screens/index.md": idx("S-1"),
      "ai/screens/S-1-orders.md": scr(
        "S-1",
        "reads: GET /screens/order-list · GET /customers\nlookups: GET /screens/order-list\n```\nreads: GET /nope · GET /nope2\n```\n",
      ),
    },
    want: [
      "! ai/screens/S-1-orders.md: reads lists 2 items",
      "! ai/screens/S-1-orders.md: GET /customers is not in ai/api/",
    ],
  },
  {
    desc: "duplicate id, bad name, bad heading, index drift",
    head: {
      "ai/kit/config.json": UI,
      "ai/screens/index.md": idx("S-1", "S-9"),
      "ai/screens/S-1-a.md": scr("S-1", ""),
      "ai/screens/S-1-b.md": scr("S-2", ""),
      "ai/screens/S-3-c.md": scr("S-3", ""),
      "ai/screens/orders.md": "x\n",
    },
    want: [
      "! ai/screens/S-1-b.md: heading must start with # S-1",
      "! ai/screens/orders.md: name it S-<n>-<slug>.md",
      "! S-1 is used by ai/screens/S-1-a.md, ai/screens/S-1-b.md: give each its own id",
      "! ai/screens/index.md: S-3 is not listed",
      "! ai/screens/index.md: S-9 has no ai/screens/S-9-<slug>.md",
    ],
  },
  {
    desc: "missing index and missing api source",
    head: {
      "ai/kit/config.json": UI,
      "ai/screens/S-1-a.md": scr("S-1", "reads: GET /x\n"),
    },
    want: ["! ui.api ai/api/ is missing or unreadable", "! ai/screens/index.md is missing"],
  },
  {
    desc: "OpenAPI YAML",
    head: {
      "ai/kit/config.json": conf({ platforms: ["mobile"], api: "openapi.yaml" }),
      "openapi.yaml":
        "openapi: 3.1.0\npaths:\n  /screens/order-list:\n    get:\n      summary: x\n  '/orders/{id}/approve':\n    post: {}\ncomponents:\n  x:\n    get: {}\n",
      "ai/screens/index.md": idx("S-1"),
      "ai/screens/S-1-a.md": scr("S-1", "reads: GET /screens/order-list\nactions: a → POST /orders/{id}/approve · b → DELETE /orders/{id}\n"),
    },
    want: ["! ai/screens/S-1-a.md: DELETE /orders/{} is not in openapi.yaml"],
  },
  {
    desc: "OpenAPI YAML: trailing comment, flow style, $ref item, nested method keys",
    head: {
      "ai/kit/config.json": conf({ platforms: ["web"], api: "openapi.yaml" }),
      "openapi.yaml": [
        "paths:",
        "  /a: # list",
        "    get:",
        "      callbacks:",
        "        x:",
        "          post: {}",
        "  /b: {get: {summary: x}, put: {}}",
        "  /c:",
        "    $ref: '#/x'",
        "  /d/{id}:",
        "    parameters: []",
        "    patch:",
        "      requestBody:",
        "        delete: x",
        "",
      ].join("\n"),
      "ai/screens/index.md": idx("S-1"),
      "ai/screens/S-1-a.md": scr(
        "S-1",
        "reads: GET /a\nactions: a → PUT /b · b → POST /c · c → PATCH /d/{id} · d → POST /a · e → DELETE /d/{id}\n",
      ),
    },
    want: ["! ai/screens/S-1-a.md: POST /a is not in openapi.yaml", "! ai/screens/S-1-a.md: DELETE /d/{} is not in openapi.yaml"],
  },
  {
    desc: "backticked API heading; a parenthesized ` · ` is one read",
    head: {
      "ai/kit/config.json": UI,
      "ai/api/a.md": "## `GET /screens/x`\n",
      "ai/screens/index.md": idx("S-1"),
      "ai/screens/S-1-a.md": scr("S-1", "reads: `GET /screens/x` (roles: a · b)\n"),
    },
    want: [],
  },
  {
    desc: "--map prints endpoint and file to screens",
    head: {
      "ai/kit/config.json": UI,
      "ai/screens/S-1-a.md": scr("S-1", "files: app/a/page.tsx\nreads: GET /x/{id}\n"),
      "ai/screens/S-2-b.md": scr("S-2", "lookups: GET /x/{key}\n"),
    },
    args: ["--map"],
    raw: true,
    want: ["app/a/page.tsx ← S-1", "GET /x/{} ← S-1, S-2"],
  },
  {
    desc: "OpenAPI JSON",
    head: {
      "ai/kit/config.json": conf({ platforms: ["web"], api: "openapi.json" }),
      "openapi.json": JSON.stringify({ paths: { "/screens/x": { get: {}, parameters: [] } } }),
      "ai/screens/index.md": idx("S-1"),
      "ai/screens/S-1-a.md": scr("S-1", "reads: GET /screens/x\nactions: a → POST /screens/x\n"),
    },
    want: ["! ai/screens/S-1-a.md: POST /screens/x is not in openapi.json"],
  },
  {
    desc: "staged: new screen file listed in no spec; listed file and folder pass",
    head: {
      "ai/kit/config.json": UI,
      "ai/api/a.md": "## GET /x\n",
      "ai/screens/index.md": idx("S-1"),
      "ai/screens/S-1-a.md": scr("S-1", "files: app/a/page.tsx · app/b/\nreads: GET /x\n"),
    },
    work: { "app/a/page.tsx": "", "app/b/c/page.tsx": "", "app/d/page.tsx": "", "app/d/part.tsx": "" },
    stage: ["app"],
    args: ["--staged"],
    want: ["! app/d/page.tsx: new screen file listed in no spec's files"],
  },
  {
    desc: "staged: nothing guarded staged → silent",
    head: { "ai/kit/config.json": UI, "ai/screens/x.md": "x\n" },
    work: { "src/x.ts": "" },
    stage: ["src"],
    args: ["--staged"],
    want: [],
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
  const dir = mkdtempSync(join(tmpdir(), "check-specs-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    put(dir, c.head);
    git("add", "-A");
    git("commit", "-qm", "head");
    put(dir, c.work);
    if (c.stage) git("add", "--", ...c.stage);
    const out = execFileSync("node", [SCRIPT, ...(c.args ?? [])], { cwd: dir, encoding: "utf8" });
    // compare each line up to its first ';' or '(' so wording after the fact can change
    const got = c.raw
      ? out.split("\n").filter(Boolean)
      : out
      .split("\n")
      .filter((l) => l.startsWith("!"))
      .map((l) => l.replace(/\s*[;(].*$/, "").replace(/:\s*(one line|endpoint links).*$/, ""));
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
