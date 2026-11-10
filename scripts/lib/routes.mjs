// Route extraction by regex (docs/screen-specs.md §Check): the HTTP routes a source file declares, for check-specs.mjs
// and the inventory. Misses dynamic routes and mounts with a prefix (app.use('/v1', router)); a warn-only caller.
const HTTP = ["get", "post", "put", "patch", "delete"];
const METHOD_RE = HTTP.join("|");

// One spelling for every path parameter: {id} :id <int:id> [id] [...slug] [[...slug]] all become {}.
export const normPath = (p) =>
  p
    .split("?")[0]
    .replace(/\[\[\.\.\.[^\]]*\]\]|\[\.\.\.[^\]]*\]|\[[^\]]*\]|<[^>]*>|\{[^}]*\}|:[A-Za-z_]\w*/g, "{}")
    .replace(/(.)\/$/, "$1");
export const normRoute = (m, p) => `${m.toUpperCase()} ${normPath(p)}`;

const join = (...parts) => {
  const s = `/${parts.map((x) => (x ?? "").replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;
  return s;
};
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

export const isTestFile = (f) => /(^|\/)(__tests__|tests?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_\w+\.py$|_test\.py$/.test(f);
export const isRouteCandidate = (f) => /\.([cm]?[jt]s|py)$/.test(f) && !/\.d\.ts$/.test(f) && !isTestFile(f);

// [{ method: "GET" | "*", path, line }] for one file; path is as declared, not normalized
export function extractRoutes(file, text) {
  const out = [];
  const add = (method, path, idx) => out.push({ method: method.toUpperCase(), path, line: lineOf(text, idx) });
  let m;
  const next = /(^|\/)app\/(.*\/)?route\.[cm]?[jt]s$/.exec(file);
  if (next) {
    const dirs = (next[2] ?? "").split("/").filter((d) => d && !/^\(.*\)$/.test(d) && !d.startsWith("@"));
    const re = /export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE)\b/g;
    while ((m = re.exec(text))) add(m[1], join(...dirs), m.index);
    return out;
  }
  const pages = /(^|\/)pages\/api\/(.+)\.[cm]?[jt]sx?$/.exec(file);
  if (pages) {
    const segs = pages[2].split("/");
    if (segs.at(-1) === "index") segs.pop();
    add("*", join("api", ...segs), 0);
    return out;
  }
  if (/\.py$/.test(file)) {
    const re = new RegExp(`^[ \\t]*@\\w+(?:\\.\\w+)*\\.(${METHOD_RE})\\(\\s*(?:path\\s*=\\s*)?["'](/[^"']*)["']`, "gm");
    while ((m = re.exec(text))) add(m[1], m[2], m.index);
    const flask = /^[ \t]*@\w+(?:\.\w+)*\.route\(\s*["'](\/[^"']*)["']([^)\n]*)/gm;
    while ((m = flask.exec(text))) {
      const methods = /methods\s*=\s*[[(]([^\])]*)/.exec(m[2])?.[1].match(/[A-Za-z]+/g) ?? ["GET"];
      for (const x of methods) if (HTTP.includes(x.toLowerCase())) add(x, m[1], m.index);
    }
    return out;
  }
  if (/\.controller\.[cm]?[jt]s$/.test(file)) {
    const ctrl = /@Controller\(\s*(?:["'`]([^"'`]*)["'`]|\{[^}]*path\s*:\s*["'`]([^"'`]*)["'`])?/.exec(text);
    const prefix = ctrl ? (ctrl[1] ?? ctrl[2] ?? "") : "";
    const re = /@(Get|Post|Put|Patch|Delete)\(\s*(?:["'`]([^"'`]*)["'`])?/g;
    while ((m = re.exec(text))) add(m[1], join(prefix, m[2]), m.index);
    return out;
  }
  if (/\.[cm]?[jt]s$/.test(file)) {
    const re = new RegExp(
      `\\b(?:app|router|server|fastify|api|\\w+Router)\\.(${METHOD_RE})\\(\\s*["'\`](/[^"'\`]*)["'\`]`,
      "g",
    );
    while ((m = re.exec(text))) add(m[1], m[2], m.index);
  }
  return out;
}
