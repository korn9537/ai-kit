// Tests for kit.mjs inventory: a fixture repo, then each wanted line must appear in the output.
// Usage: node scripts/kit-inventory.test.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dirname, "kit.mjs");
const FILES = {
  "ai/kit/config.json": "{}",
  "ai/tasks/a.md": "x",
  "ai/notes.md": "x",
  "package.json": JSON.stringify({ dependencies: { next: "15" } }),
  "prisma/schema.prisma": "x",
  "app/orders/page.tsx": "x",
  "app/orders/[id]/page.tsx": "x",
  "app/api/orders/route.ts": "x",
  "pages/api/x.ts": "x",
  "openapi.yaml": "x",
  "docs/adr/0001-x.md": "x",
  "src/decision-node.ts": "x",
  "website/package.json": JSON.stringify({ dependencies: { react: "18" } }),
  "docs/requirements.md": "x",
  "README.md": "x",
  "node_modules/a/app/page.tsx": "x",
};
const WANT = [
  "ui: unset · detected: web",
  "## ai/ entries outside the layout (1)",
  "  ai/tasks",
  "## schema sources → ai/data/ (1)",
  "  prisma/ (1)",
  "## screen files → ai/screens/ (2)",
  "  app/orders/ (1)",
  "## API spec files → ui.api (1)",
  "  openapi.yaml",
  "## route files → ai/api/ when no API spec file (2)",
  "## decision docs → ai/decisions.md (1)",
  "  docs/adr/0001-x.md",
  "## other .md outside ai/ (requirements, decisions or human docs) (1)",
  "  docs/ (1)",
];

const dir = mkdtempSync(join(tmpdir(), "kit-inventory-"));
let fail = 0;
try {
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), t);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A", "-f"], { cwd: dir });
  const lines = execFileSync("node", [SCRIPT, "inventory"], { cwd: dir, encoding: "utf8" }).split("\n");
  for (const w of WANT) {
    const ok = lines.includes(w);
    console.log(`${ok ? "ok  " : "FAIL"} - ${w}`);
    if (!ok) fail++;
  }
  const sugg = lines.find((l) => l.startsWith("  ui.include suggestion: "));
  const re = sugg && new RegExp(JSON.parse(sugg.slice("  ui.include suggestion: ".length)));
  const ok = !!re && re.test("app/orders/page.tsx") && !re.test("app/api/orders/route.ts");
  console.log(`${ok ? "ok  " : "FAIL"} - ui.include suggestion matches pages, not routes`);
  if (!ok) fail++;
  if (fail) console.log(lines.join("\n"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
// a tracked docs site and an untracked folder do not make a backend repo look like web
const dir2 = mkdtempSync(join(tmpdir(), "kit-inventory-"));
try {
  const put = (p, t) => {
    mkdirSync(dirname(join(dir2, p)), { recursive: true });
    writeFileSync(join(dir2, p), t);
  };
  put("ai/kit/config.json", "{}");
  put("go.mod", "module x");
  put("website/package.json", JSON.stringify({ dependencies: { react: "18" } }));
  execFileSync("git", ["init", "-q"], { cwd: dir2 });
  execFileSync("git", ["add", "-A"], { cwd: dir2 });
  put("tmp/package.json", JSON.stringify({ dependencies: { react: "18" } }));
  const out = execFileSync("node", [SCRIPT, "inventory"], { cwd: dir2, encoding: "utf8" });
  const ok = out.split("\n").includes("ui: unset · detected: none");
  console.log(`${ok ? "ok  " : "FAIL"} - docs site and untracked folder are not UI`);
  if (!ok) fail++;
} finally {
  rmSync(dir2, { recursive: true, force: true });
}
console.log(`\n${WANT.length + 2 - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
