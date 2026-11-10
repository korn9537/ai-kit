// Reports screen specs out of step with the API and the code (docs/screen-specs.md §Check). Warnings only, exit 0.
// Usage, cwd in the repo: node <plugin>/scripts/check-specs.mjs [--staged: only on a guarded staged file] [--map] [--all]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractRoutes, isRouteCandidate, normRoute } from "./lib/routes.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const git = (...a) => {
  try {
    return execFileSync("git", ["-c", "core.quotePath=false", ...a], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1 << 28,
    });
  } catch {
    return null;
  }
};
const root = git("rev-parse", "--show-toplevel")?.trim();
if (!root) process.exit(0);
process.chdir(root);

let ui = {};
if (existsSync("ai/kit/config.json")) {
  try {
    ui = JSON.parse(readFileSync("ai/kit/config.json", "utf8"))?.ui ?? {};
  } catch (e) {
    console.log(`specs: ai/kit/config.json is not valid JSON, screen-spec checks are off: ${e.message}`);
  }
}
const screensOn = Array.isArray(ui.platforms) && ui.platforms.length > 0;
// route check: on when ui.api is set, off with ui.routes false; it also runs in a repo with no ui.platforms
const routesOn = typeof ui.api === "string" && ui.routes !== false;
if (!screensOn && !routesOn) process.exit(0);
const DIR = "ai/screens";
const API = typeof ui.api === "string" ? ui.api : "ai/api/";
const apiRel = API.replace(/^\.\//, "").replace(/\/$/, "");
// a bad regex is a kit.mjs check problem; here it only turns the new-file check off
let INCLUDE = null;
try {
  if (typeof ui.include === "string") INCLUDE = new RegExp(ui.include);
} catch {}

const list = (...a) => (git(...a, "-z") ?? "").split("\0").filter(Boolean);
// specs are read from the working tree, so a partially staged spec is checked as edited
if (flag("staged")) {
  const guarded = (f) =>
    (screensOn && (f.startsWith(`${DIR}/`) || INCLUDE?.test(f))) ||
    f === apiRel ||
    f.startsWith(`${apiRel}/`) ||
    (routesOn && isRouteCandidate(f));
  if (!list("diff", "--cached", "--name-only", "--diff-filter=ACMRD").some(guarded)) process.exit(0);
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const EP = new RegExp(`\\b(${METHODS.join("|")})\\s+(/[^\\s·,;)\`]*)`, "g");
const norm = normRoute;
// lines outside fenced blocks: a fence closes on its own marker and length, so ~~~ inside ``` is text; a backtick
// fence's info string holds no backtick (```x``` is inline)
const prose = (text) => {
  let fence = null;
  return text.split(/\r?\n/).filter((l) => {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(l);
    const f = m && !(m[1][0] === "`" && m[2].includes("`")) ? m[1] : null;
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length && !m[2].trim()) fence = null;
      return false;
    }
    if (f) fence = f;
    return !f;
  });
};
// a value's items, split on ` · ` outside parentheses: `GET /x (roles: a · b)` is one item
const items = (v) => {
  const out = [""];
  let depth = 0;
  for (const part of v.split(/(\s+·\s+|[()])/)) {
    if (part === "(") depth++;
    else if (part === ")" && depth) depth--;
    if (!depth && /^\s+·\s+$/.test(part)) out.push("");
    else out[out.length - 1] += part;
  }
  return out.map((s) => s.trim()).filter(Boolean);
};

const warn = [];
const screens = [];
const ids = new Map();
const names = screensOn && existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".md") && f !== "index.md") : [];
for (const f of names) {
  const path = `${DIR}/${f}`;
  const m = /^S-(\d+)-[a-z0-9-]+\.md$/.exec(f);
  if (!m) {
    warn.push(`${path}: name it S-<n>-<slug>.md`);
    continue;
  }
  const id = `S-${m[1]}`;
  ids.set(id, [...(ids.get(id) ?? []), path]);
  const lines = prose(readFileSync(path, "utf8"));
  const h = lines.find((l) => /^#\s/.test(l));
  if (!h || !new RegExp(`^#\\s+${id}\\b`).test(h)) warn.push(`${path}: heading must start with # ${id}`);
  const keys = {};
  for (const l of lines) {
    const k = /^(reads|lookups|loads|actions|files):\s*(.*)$/.exec(l);
    if (k) keys[k[1]] = [...(keys[k[1]] ?? []), ...items(k[2])];
  }
  if ((keys.reads ?? []).length > 1)
    warn.push(
      `${path}: reads lists ${keys.reads.length} items; one server read per screen, a declared extra goes under lookups or loads (the plugin's conventions/general.md item 11)`,
    );
  const eps = ["reads", "lookups", "loads", "actions"].flatMap((k) =>
    (keys[k] ?? []).flatMap((v) => [...v.matchAll(EP)].map((e) => norm(e[1], e[2]))),
  );
  const files = (keys.files ?? []).map((v) => v.replace(/`/g, "").replace(/^\.\//, ""));
  screens.push({ id, path, eps: [...new Set(eps)], files });
}
for (const [id, ps] of ids) if (ps.length > 1) warn.push(`${id} is used by ${ps.join(", ")}: give each its own id`);

// endpoints the API source declares; null = source missing or unreadable
function apiEndpoints() {
  if (!existsSync(API)) return null;
  const set = new Set();
  const fromMd = (text) => {
    for (const l of prose(text)) {
      const m = new RegExp(`^#{1,6}\\s+\`?(${METHODS.join("|")})\\s+(/[^\\s\`]*)`).exec(l);
      if (m) set.add(norm(m[1], m[2]));
    }
  };
  if (statSync(API).isDirectory()) {
    for (const f of readdirSync(API, { recursive: true }))
      if (String(f).endsWith(".md")) fromMd(readFileSync(join(API, String(f)), "utf8"));
  } else if (/\.json$/i.test(API)) {
    try {
      for (const [p, ops] of Object.entries(JSON.parse(readFileSync(API, "utf8")).paths ?? {}))
        for (const m of Object.keys(ops ?? {}))
          if (METHODS.includes(m.toUpperCase()) || m === "$ref") set.add(norm(m === "$ref" ? "*" : m, p));
    } catch {
      return null;
    }
  } else if (/\.ya?ml$/i.test(API)) {
    // OpenAPI YAML without a parser: path keys under top-level paths:, method keys at the path's first child
    // indent (block or flow style); a $ref path item allows every method
    let inPaths = false;
    let cur = null;
    let pathIndent = -1;
    let opIndent = -1;
    for (const raw of readFileSync(API, "utf8").split(/\r?\n/)) {
      const l = raw.replace(/\s+#.*$/, "");
      if (!l.trim() || /^\s*#/.test(l)) continue;
      if (/^\S/.test(l)) {
        inPaths = /^paths:\s*$/.test(l);
        cur = null;
        continue;
      }
      if (!inPaths) continue;
      const ind = l.match(/^\s*/)[0].length;
      if (pathIndent < 0) pathIndent = ind;
      if (ind <= pathIndent) {
        const p = /^\s+['"]?(\/[^'"]*?)['"]?:\s*(\{.*)?$/.exec(l);
        cur = ind === pathIndent && p ? p[1] : null;
        opIndent = -1;
        if (cur && p[2])
          for (const m of p[2].matchAll(/[{,]\s*(get|put|post|patch|delete|\$ref)\s*:/g))
            set.add(norm(m[1] === "$ref" ? "*" : m[1], cur));
        continue;
      }
      if (!cur) continue;
      if (opIndent < 0) opIndent = ind;
      const m = /^\s+(get|put|post|patch|delete|\$ref):/.exec(l);
      if (m && ind === opIndent) set.add(norm(m[1] === "$ref" ? "*" : m[1], cur));
    }
  } else fromMd(readFileSync(API, "utf8"));
  return set;
}

if (flag("map")) {
  const byEp = new Map();
  const byFile = new Map();
  for (const s of screens) {
    for (const e of s.eps) byEp.set(e, [...(byEp.get(e) ?? []), s.id]);
    for (const f of s.files) byFile.set(f, [...(byFile.get(f) ?? []), s.id]);
  }
  for (const [k, v] of [...byEp, ...byFile].sort(([a], [b]) => a.localeCompare(b)))
    console.log(`${k} ← ${v.join(", ")}`);
  process.exit(0);
}

const api = apiEndpoints();
if (api === null) {
  if (screens.some((s) => s.eps.length))
    warn.push(`ui.api ${API} is missing or unreadable: endpoint links not checked (API in another repo: point ui.api at a local copy of its spec)`);
} else
  for (const s of screens) for (const e of s.eps) if (!api.has(e) && !api.has(e.replace(/^\S+/, "*"))) warn.push(`${s.path}: ${e} is not in ${API}`);

if (routesOn && api && (flag("staged") || flag("all"))) {
  const files = flag("all") ? list("ls-files") : list("diff", "--cached", "--name-only", "--diff-filter=ACMR");
  for (const f of files.filter((x) => isRouteCandidate(x) && !INCLUDE?.test(x))) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const r of extractRoutes(f, text)) {
      const n = norm(r.method === "*" ? "GET" : r.method, r.path);
      const path = n.replace(/^\S+ /, "");
      const has =
        r.method === "*" ? [...api].some((e) => e.endsWith(` ${path}`)) : api.has(n) || api.has(`* ${path}`);
      if (!has) warn.push(`${r.method} ${r.path} (${f}:${r.line}) has no entry in ${API}`);
    }
  }
}

if (names.length) {
  const idx = `${DIR}/index.md`;
  if (!existsSync(idx)) warn.push(`${idx} is missing: one line per screen, - S-<n> <name> → S-<n>-<slug>.md`);
  else {
    const listed = new Set(prose(readFileSync(idx, "utf8")).flatMap((l) => l.match(/\bS-\d+\b/g) ?? []));
    for (const id of ids.keys()) if (!listed.has(id)) warn.push(`${idx}: ${id} is not listed`);
    for (const id of listed) if (!ids.has(id)) warn.push(`${idx}: ${id} has no ${DIR}/${id}-<slug>.md`);
  }
}

if (flag("staged") && INCLUDE) {
  const covered = (f) => screens.some((s) => s.files.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)));
  for (const f of list("diff", "--cached", "--name-only", "--diff-filter=A"))
    if (INCLUDE.test(f) && !covered(f))
      warn.push(`${f}: new screen file listed in no spec's files (add it to its ${DIR}/S-<n> spec, the plugin's docs/screen-specs.md)`);
}

warn.forEach((w) => console.log(`! ${w}`));
