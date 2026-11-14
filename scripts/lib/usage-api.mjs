// Client of the ai-kit-usage API (repo korn9537/ai-kit-usage, README §API): endpoint, project id, POST and paged GET.
// No auth by owner decision; errors carry a one-line message for the CLI.
import { execFileSync } from "node:child_process";
import { basename, dirname } from "node:path";

export const DEFAULT_ENDPOINT = "https://ai-kit-usage.maybix.com";

// AI_KIT_USAGE_ENDPOINT (tests) over config usage.endpoint over the default.
export const endpointOf = (usageConf = {}) =>
  String(process.env.AI_KIT_USAGE_ENDPOINT || usageConf.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, "");

const git = (cwd, args) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

// origin URL without scheme, user and .git, lowercased; scp form host:o/r becomes host/o/r (the server README's rule).
export function normalizeRemote(url) {
  let u = String(url ?? "").trim();
  if (!u) return "";
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i;
  const hadScheme = scheme.test(u);
  u = u.replace(scheme, "").replace(/^[^@/]*@/, "");
  if (!hadScheme) u = u.replace(/^([^/:]+):/, "$1/");
  return u.replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
}

export function projectId(root) {
  const id = normalizeRemote(git(root, ["remote", "get-url", "origin"]));
  if (id) return id;
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const main = common ? (basename(common) === ".git" ? dirname(common) : common.replace(/\.git$/, "")) : root;
  return `local/${basename(main)}`;
}

const reach = (base, e) => {
  if (e?.status) return e;
  const why = e?.name === "TimeoutError" ? "timed out" : (e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(e));
  return new Error(`usage API ${base} unreachable: ${why}`);
};

export async function postJson(base, path, body, timeoutMs = 120000) {
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`POST ${path}: HTTP ${res.status} ${text.replace(/\s+/g, " ").slice(0, 300)}`), { status: res.status });
    return text ? JSON.parse(text) : {};
  } catch (e) {
    throw reach(base, e);
  }
}

export async function getJson(base, path, query = {}, timeoutMs = 60000) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const url = `${base}${path}${q.size ? `?${q}` : ""}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = JSON.parse(text).error ?? text;
      } catch {}
      throw Object.assign(new Error(`GET ${path}: HTTP ${res.status} ${String(msg).replace(/\s+/g, " ").slice(0, 300)}`), { status: res.status });
    }
    return JSON.parse(text);
  } catch (e) {
    throw reach(base, e);
  }
}

// Every page of a keyset-paged GET (/v1/records, /v1/decisions, /v1/refusals), oldest first.
export async function getAll(base, path, query = {}) {
  const items = [];
  let after = "";
  for (;;) {
    const page = await getJson(base, path, { ...query, limit: 10000, after });
    items.push(...(page.items ?? []));
    if (!page.next || page.next === after) return items;
    after = page.next;
  }
}

// A view's rows as a fixed-width table: numbers rounded, timestamps to the minute, cells cut to `width`.
export function formatTable(rows, { cap = 60, width = 40 } = {}) {
  if (!rows.length) return "no rows";
  const cols = Object.keys(rows[0]);
  const num = (v) => (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v)) ? Number(v) : null);
  const show = (v) => {
    if (v === null || v === undefined) return "-";
    const n = num(v);
    if (n !== null) return Math.abs(n) >= 100 || Number.isInteger(n) ? String(Math.round(n)) : String(Math.round(n * 100) / 100);
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return v.slice(0, 16).replace("T", " ");
    const t = (typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\s+/g, " ");
    return [...t].length > width ? `${[...t].slice(0, width - 1).join("")}…` : t;
  };
  const body = rows.slice(0, cap).map((r) => cols.map((c) => show(r[c])));
  const w = cols.map((c, i) => Math.max(c.length, ...body.map((r) => [...r[i]].length)));
  const shown = rows.slice(0, cap);
  const right = cols.map((c) => shown.some((r) => num(r[c]) !== null) && shown.every((r) => r[c] === null || r[c] === undefined || num(r[c]) !== null));
  const line = (cells) => cells.map((x, i) => (right[i] ? x.padStart(w[i]) : x.padEnd(w[i]))).join("  ").trimEnd();
  const out = [line(cols), ...body.map(line)];
  if (rows.length > cap) out.push(`+${rows.length - cap} more rows`);
  return out.join("\n");
}
