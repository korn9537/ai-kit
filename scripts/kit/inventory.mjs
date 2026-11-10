// kit inventory: what a project holds, by area; see scripts/kit.mjs
import { lsFiles, readConf } from "./shared.mjs";
import { detectUi, layoutWarnings } from "./check.mjs";

// inventory: what a retrofit (commands/retrofit.md) starts from; heuristics over tracked files, read-only
const INV = {
  schema: [
    /(^|\/)prisma\/schema\.prisma$/,
    /(^|\/)(migrations?|db\/migrate|alembic\/versions)\/.+\.(sql|ts|js|py|rb|go|cs)$/i,
    /(^|\/)(models?|entities|entity)\/[^/]+\.(ts|js|py|rb|go|cs|dart)$/i,
    /(^|\/)Configurations\/(.+\/)?[^/]+Configuration\.cs$/,
    /\.entity\.ts$/,
    /(^|\/)(schema|db\/schema)\.(ts|sql|rb)$/,
    /DbContext\.cs$/,
  ],
  screens: [
    /(^|\/)app\/(.+\/)?page\.(tsx|jsx|ts|js)$/,
    /(^|\/)pages\/(?!api\/).+\.(tsx|jsx|vue)$/,
    /(^|\/)routes\/(.+\/)?\+page\.svelte$/,
    /(^|\/)views\/.+\.vue$/,
    /(^|\/)screens\/.+\.(tsx|jsx|dart)$/,
    /_screen\.dart$/,
  ],
  api: [/(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$/i],
  routes: [
    /(^|\/)app\/(.+\/)?route\.(ts|js)$/,
    /(^|\/)pages\/api\//,
    /(^|\/)(routes|controllers|handlers|endpoints)\/.+\.(ts|js|py|rb|go|cs)$/i,
    /(Controller|Endpoints?)\.cs$/,
  ],
  decisions: [/(^|\/)(adrs?|decisions?)(\/.*)?[^/]*\.(md|markdown|adoc|txt)$/i],
};

const SKIP_DIRS = /(^|\/)(node_modules|vendor|dist|build|\.next|Pods|\.dart_tool)\//;

// "dir/ (n files)" lines, largest first; deeper folders fold into their parents until at most 40 remain
const grouped = (files) => {
  const dirs = files.map((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")).split("/") : []));
  let depth = Math.max(0, ...dirs.map((d) => d.length));
  let by;
  for (;;) {
    by = new Map();
    for (const d of dirs) {
      const k = d.length ? `${d.slice(0, depth).join("/")}/` : "./";
      by.set(k, (by.get(k) ?? 0) + 1);
    }
    if (by.size <= 40 || depth <= 1) break;
    depth--;
  }
  return [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d, n]) => `  ${d} (${n})`);
};

function inventory() {
  const all = lsFiles();
  if (!all.length) console.log("! git lists no tracked files here: inventory is empty");
  const files = all.filter((f) => !SKIP_DIRS.test(f) && !f.startsWith("ai/"));
  const conf = readConf().conf ?? {};
  const out = ["ai-kit inventory (heuristics: verify each group against the code)"];
  // n: files in the section, when the lines are folder groups
  const sec = (title, list, n = list.length) => {
    out.push(`\n## ${title} (${n})`);
    out.push(...(list.length ? list : ["  none"]));
  };
  out.push(`ui: ${conf.ui === undefined ? "unset" : JSON.stringify(conf.ui)} · detected: ${detectUi().join(", ") || "none"}`);
  out.push(`docs.include: ${JSON.stringify(conf.docs?.include ?? null)}`);
  sec("ai/ entries outside the layout", layoutWarnings(conf).map((w) => `  ${w.split(" ")[0]}`));
  const hit = (k) => files.filter((f) => INV[k].some((re) => re.test(f)));
  const schema = hit("schema");
  sec("schema sources → ai/data/", grouped(schema), schema.length);
  const screens = hit("screens");
  sec("screen files → ai/screens/", grouped(screens), screens.length);
  const used = INV.screens.filter((re) => screens.some((f) => re.test(f)));
  if (used.length) out.push(`  ui.include suggestion: ${JSON.stringify(used.map((re) => re.source).join("|"))}`);
  sec("API spec files → ui.api", hit("api").map((f) => `  ${f}`));
  const routes = hit("routes");
  sec("route files → ai/api/ when no API spec file", grouped(routes), routes.length);
  const decisions = hit("decisions");
  sec("decision docs → ai/decisions.md", decisions.map((f) => `  ${f}`));
  const plain = (f) => f.endsWith(".md") && !/(^|\/)(README|CHANGELOG|LICENSE|CLAUDE|AGENTS)\.md$/i.test(f) && !decisions.includes(f);
  const other = files.filter(plain);
  sec("other .md outside ai/ (requirements, decisions or human docs)", grouped(other), other.length);
  console.log(out.join("\n"));
}

export { inventory };
