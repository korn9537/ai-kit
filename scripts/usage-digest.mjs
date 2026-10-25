// Usage records to a fixed-size digest for an agent (docs/ai-docs.md form; every list capped), plus loading records
// from ai/usage/** and building in-memory baseline records from local transcripts.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { collectSession, transcriptsDir } from "./usage-collect.mjs";
import { buildRecord, fmtTok, fmtUsd, modelShort, weight } from "./usage-record.mjs";

const CAP = { models: 6, users: 5, projects: 5, roles: 6, roleModels: 3, tools: 5, rounds: 10, kits: 10, outliers: 10, months: 6, mix: 3 };
const PEAK_OUTLIER = 150000;
const CALLS_OUTLIER = 150;
const EXCERPT = 200;
const TYPES = ["input", "read", "write_5m", "write_1h", "output"];

// ---- loading ----

export function loadRecords(usageDir, since = "") {
  const out = { recs: [], bad: 0 };
  let files = [];
  try {
    files = readdirSync(usageDir, { recursive: true }).map(String).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return out;
  }
  for (const f of files) {
    let text = "";
    try {
      text = readFileSync(join(usageDir, f), "utf8");
    } catch {
      out.bad++;
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        out.bad++;
        continue;
      }
      if (!r || typeof r !== "object" || typeof r.ts !== "string" || !Array.isArray(r.agents)) {
        out.bad++;
        continue;
      }
      if (since && !(r.ts >= since)) continue;
      out.recs.push(r);
    }
  }
  return out;
}

// One in-memory record per local session (whole session as one round-delta, prompts full, kit "baseline"); never written.
export function baselineRecords(repoRoot, who = {}, since = "") {
  const dir = transcriptsDir(repoRoot);
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort();
  } catch {}
  const out = { recs: [], skipped: 0 };
  for (const n of names) {
    const path = join(dir, n);
    try {
      const session = basename(n, ".jsonl");
      const rec = buildRecord(collectSession(path), [], {
        now: statSync(path).mtime, session, kit: "baseline", prompts: "full",
        project: who.project ?? "", user: who.user ?? "", branch: who.branch ?? "",
      });
      if (rec && (!since || rec.ts >= since)) out.recs.push(rec);
    } catch {
      out.skipped++;
    }
  }
  return out;
}

// ---- digest ----

const pct = (x, total) => `${total > 0 ? Math.round((100 * x) / total) : 0}%`;
const one = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return [...t].length > n ? `${[...t].slice(0, n - 1).join("")}…` : t;
};
const rawTokens = (a) => TYPES.reduce((n, k) => n + (a[k] ?? 0), 0);
const sum = (xs) => xs.reduce((n, x) => n + x, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);
const top = (map, n) => [...map].sort((x, y) => y[1] - x[1]).slice(0, n);
const bump = (map, k, x) => map.set(k, (map.get(k) ?? 0) + x);
const bySemver = (a, b) => (a === "baseline" ? -1 : b === "baseline" ? 1 : a.localeCompare(b, "en", { numeric: true }));
const nameOf = (s, fallback) => one(s, 20).replace(/\s/g, "_") || fallback;

export function digest(recs, prices, meta = {}) {
  const extra = [meta.bad ? `${meta.bad} bad lines` : "", meta.skipped ? `${meta.skipped} sessions skipped` : ""].filter(Boolean);
  if (!recs.length) return ["no usage records", ...extra].join(" · ");
  recs = [...recs].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  // One row per agent per record; cost is null for a model with no price.
  const rows = [];
  for (const r of recs) {
    for (const a of r.agents) rows.push({ r, a, role: a.role ?? "other", cost: weight(a, prices), key: `${r.session}/${a.id}`, rk: `${r.session}#${r.round}` });
  }
  const c = (x) => x.cost ?? 0;
  const total = sum(rows.map(c));
  const sessions = new Set(recs.map((r) => r.session));
  const rounds = new Set(recs.map((r) => `${r.session}#${r.round}`));
  const commits = new Set(recs.flatMap((r) => r.commits ?? []));

  // Distinct agents: calls and tools add up across records, peak and largest result are maxima.
  const agents = new Map();
  for (const x of rows) {
    const g = agents.get(x.key) ?? { role: x.role, desc: x.a.desc, model: x.a.model, session: x.r.session, user: x.r.user, calls: 0, peak: 0, largest: 0, cost: 0, tools: new Map(), findings: null, kit: x.r.kit };
    g.calls += x.a.calls ?? 0;
    g.peak = Math.max(g.peak, x.a.peak ?? 0);
    g.largest = Math.max(g.largest, x.a.largest_result ?? 0);
    g.cost += c(x);
    for (const [t, n] of Object.entries(x.a.tools ?? {})) bump(g.tools, t, n);
    if (x.a.findings) g.findings = x.a.findings;
    agents.set(x.key, g);
  }

  const out = [];
  const range = `${recs[0].ts.slice(0, 10)}..${recs[recs.length - 1].ts.slice(0, 10)}`;
  out.push([`records ${recs.length}`, `sessions ${sessions.size}`, `rounds ${rounds.size}`, `commits ${commits.size}`, range,
    ...(meta.source ? [meta.source] : []), ...extra].join(" · "));

  // totals
  out.push("## totals");
  const models = new Map();
  const unpriced = new Map();
  const types = new Map();
  for (const x of rows) {
    const m = modelShort(x.a.model);
    const e = models.get(m) ?? { cost: 0, calls: 0, read: 0, write: 0, output: 0 };
    e.cost += c(x);
    e.calls += x.a.calls ?? 0;
    e.read += x.a.read ?? 0;
    e.write += (x.a.write_5m ?? 0) + (x.a.write_1h ?? 0);
    e.output += x.a.output ?? 0;
    models.set(m, e);
    if (x.cost === null) bump(unpriced, one(x.a.model || "?", 30), rawTokens(x.a));
    else for (const t of TYPES) bump(types, t, weight({ model: x.a.model, [t]: x.a[t] ?? 0 }, prices) ?? 0);
  }
  out.push(`cost: ${fmtUsd(total)}`);
  const ms = [...models].filter(([, e]) => e.cost > 0).sort((a, b) => b[1].cost - a[1].cost);
  for (const [m, e] of ms.slice(0, CAP.models))
    out.push(`${m}: ${fmtUsd(e.cost)} ${pct(e.cost, total)} · ${fmtTok(e.calls)} calls · read ${fmtTok(e.read)} · write ${fmtTok(e.write)} · out ${fmtTok(e.output)}`);
  if (ms.length > CAP.models) out.push(`+${ms.length - CAP.models} more models`);
  const typeLine = top(types, 5).filter(([, v]) => total > 0 && v / total >= 0.005).map(([t, v]) => `${t.replace("_", " ")} ${pct(v, total)}`).join(" · ");
  if (typeLine) out.push(`by type: ${typeLine}`);
  for (const [label, field, cap] of [["user", "user", CAP.users], ["project", "project", CAP.projects]]) {
    const g = new Map();
    for (const x of rows) bump(g, nameOf(x.r[field], "unknown"), c(x));
    const shown = top(g, cap).filter(([, v]) => v > 0);
    if (g.size > 1 && shown.length) out.push(`by ${label}: ${shown.map(([k, v]) => `${k} ${fmtUsd(v)} ${pct(v, total)}`).join(", ")}${g.size > cap ? `, +${g.size - cap}` : ""}`);
  }
  if (unpriced.size) {
    const u = top(unpriced, 3);
    out.push(`unpriced: ${sum([...unpriced.values()])} tok (${u.map(([k]) => k).join(", ")}${unpriced.size > 3 ? ", …" : ""})`);
  }

  // by role: share of cost, split by model within the role
  out.push("## by role");
  const roles = new Map();
  for (const x of rows) {
    const e = roles.get(x.role) ?? { cost: 0, models: new Map() };
    e.cost += c(x);
    bump(e.models, modelShort(x.a.model), c(x));
    roles.set(x.role, e);
  }
  const rs = [...roles].sort((a, b) => b[1].cost - a[1].cost);
  for (const [role, e] of rs.slice(0, CAP.roles)) {
    const inRole = top(e.models, CAP.roleModels).filter(([, v]) => v > 0).map(([m, v]) => `${m} ${pct(v, e.cost)}`).join(", ");
    out.push(`${one(role, 20)} ${pct(e.cost, total)} (${inRole}) ${fmtUsd(e.cost)}`);
  }
  if (rs.length > CAP.roles) out.push(`+${rs.length - CAP.roles} more roles`);

  // per commit / round / session
  out.push("## per commit");
  out.push(commits.size ? `per commit ≈ ${fmtUsd(total / commits.size)} (commits ${commits.size}, total ${fmtUsd(total)})` : "per commit: none (commits 0)");
  out.push(`per round ≈ ${fmtUsd(total / rounds.size)} (rounds ${rounds.size})`);
  out.push(`per session ≈ ${fmtUsd(total / sessions.size)} (sessions ${sessions.size})`);

  // by kit version
  out.push("## by kit");
  const kits = new Map();
  for (const r of recs) {
    const k = one(r.kit || "?", 20);
    const e = kits.get(k) ?? { recs: [] };
    e.recs.push(r);
    kits.set(k, e);
  }
  const names = [...kits.keys()].sort(bySemver);
  const shownKits = names.length > CAP.kits ? [...names.filter((n) => n === "baseline"), ...names.filter((n) => n !== "baseline").slice(-(CAP.kits - (names.includes("baseline") ? 1 : 0)))] : names;
  for (const k of shownKits) {
    const rr = kits.get(k).recs;
    const kr = rr.flatMap((r) => r.agents.map((a) => ({ r, a, cost: weight(a, prices) ?? 0 })));
    const cost = sum(kr.map((x) => x.cost));
    const s = new Set(rr.map((r) => r.session));
    const rd = new Set(rr.map((r) => `${r.session}#${r.round}`));
    const cm = new Set(rr.flatMap((r) => r.commits ?? []));
    const share = (f) => pct(sum(kr.filter(f).map((x) => x.cost)), cost);
    const mine = [...agents.values()].filter((g) => g.kit === k);
    const cAgents = mine.filter((g) => g.role === "commit");
    const mains = mine.filter((g) => g.role === "coordinator");
    const parts = [`${s.size}s ${rd.size}r`, fmtUsd(cost), `${fmtUsd(cost / rd.size)}/round`, cm.size ? `${fmtUsd(cost / cm.size)}/commit` : "no commits",
      `commit ${share((x) => x.a.role === "commit")}`, `opus ${share((x) => modelShort(x.a.model) === "opus")}`];
    if (cAgents.length) parts.push(`commit calls ${Math.round(mean(cAgents.map((g) => g.calls)))}`);
    if (mains.length) parts.push(`main peak ${fmtTok(mean(mains.map((g) => g.peak)))}`);
    out.push(`${k} · ${parts.join(" · ")}`);
  }
  if (names.length > shownKits.length) out.push(`+${names.length - shownKits.length} older kits omitted`);

  // drivers per role: what makes the agents of a role expensive
  out.push("## drivers");
  const byRole = new Map();
  for (const g of agents.values()) {
    const e = byRole.get(g.role) ?? { cost: 0, list: [], tools: new Map() };
    e.cost += g.cost;
    e.list.push(g);
    for (const [t, n] of g.tools) bump(e.tools, t, n);
    byRole.set(g.role, e);
  }
  for (const [role, e] of [...byRole].sort((a, b) => b[1].cost - a[1].cost).slice(0, CAP.roles)) {
    const tools = top(e.tools, CAP.tools).map(([t, n]) => `${one(t, 30)} ${n}`).join(", ");
    out.push(`${one(role, 20)}: ${e.list.length} agents · calls mean ${Math.round(mean(e.list.map((g) => g.calls)))} max ${Math.max(...e.list.map((g) => g.calls))}`
      + ` · peak mean ${fmtTok(mean(e.list.map((g) => g.peak)))} max ${fmtTok(Math.max(...e.list.map((g) => g.peak)))}`
      + ` · largest result ${fmtTok(Math.max(...e.list.map((g) => g.largest)))}${tools ? ` · tools ${tools}` : ""}`);
  }
  const months = new Map();
  for (const r of recs) if (Number.isFinite(r.base_context)) (months.get(r.ts.slice(0, 7)) ?? months.set(r.ts.slice(0, 7), []).get(r.ts.slice(0, 7))).push(r.base_context);
  if (months.size) out.push(`base context: ${[...months].sort().slice(-CAP.months).map(([m, v]) => `${m} ${fmtTok(mean(v))}`).join(" · ")}`);

  // reviewer findings per model
  out.push("## reviews");
  const rev = new Map();
  for (const g of agents.values()) {
    if (g.role !== "reviewer" || !g.findings) continue;
    const e = rev.get(modelShort(g.model)) ?? { n: 0, confirmed: 0, plausible: 0, cost: 0 };
    e.n++;
    e.confirmed += g.findings.confirmed ?? 0;
    e.plausible += g.findings.plausible ?? 0;
    e.cost += g.cost;
    rev.set(modelShort(g.model), e);
  }
  if (!rev.size) out.push("none");
  for (const [m, e] of [...rev].sort((a, b) => b[1].n - a[1].n).slice(0, CAP.models)) {
    const per = (x) => (Math.round((10 * x) / e.n) / 10).toString();
    out.push(`${m}: ${e.n} reviews, ${per(e.confirmed)} confirmed/review, ${per(e.plausible)} plausible/review, ${fmtUsd(e.cost / e.n)}/review`);
  }

  // costliest rounds: a round's records are summed
  out.push("## costliest rounds");
  const rds = new Map();
  for (const x of rows) {
    const e = rds.get(x.rk) ?? { cost: 0, round: x.r.round, user: x.r.user, prompt: "", roles: new Map() };
    e.cost += c(x);
    e.prompt ||= x.r.prompt ?? "";
    bump(e.roles, x.role, c(x));
    rds.set(x.rk, e);
  }
  const costly = [...rds.values()].filter((e) => e.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, CAP.rounds);
  if (!costly.length) out.push("none");
  for (const e of costly) {
    const mix = top(e.roles, CAP.mix).filter(([, v]) => v > 0).map(([k, v]) => `${one(k, 12)} ${pct(v, e.cost)}`).join(" ");
    out.push(`- ${fmtUsd(e.cost)} r${e.round} ${nameOf(e.user, "anon")}: ${mix} | ${one(e.prompt || "(no prompt)", Math.max(20, EXCERPT - mix.length - 3))}`);
  }

  // outliers
  out.push("## outliers");
  const outl = [...agents.values()].filter((g) => g.peak > PEAK_OUTLIER || g.calls > CALLS_OUTLIER).sort((a, b) => b.cost - a.cost);
  if (!outl.length) out.push("none");
  for (const g of outl.slice(0, CAP.outliers))
    out.push(`- ${fmtUsd(g.cost)} ${one(g.role, 12)}${g.desc ? ` "${one(g.desc, 40)}"` : ""} ${modelShort(g.model)} · peak ${fmtTok(g.peak)} · ${g.calls} calls · ${String(g.session).slice(0, 8)} ${nameOf(g.user, "anon")}`);
  if (outl.length > CAP.outliers) out.push(`+${outl.length - CAP.outliers} more`);
  return out.join("\n");
}
