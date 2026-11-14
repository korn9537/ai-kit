// Usage records: per-round delta record and summary line (prices: base input $/MTok by model prefix), then the fixed-size
// digest of them (docs/ai-docs.md form; every list capped), record loading and local-transcript baseline records.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { collectSession, transcriptsDir } from "./usage-collect.mjs";

export const DEFAULT_PRICES = {
  "claude-opus-5-5": 4,
  "claude-sonnet-5-5": 2,
};

const DEFAULT_RATIOS = {
  "claude-opus-5-5": { read: 0.05, write_5m: 1.25, write_1h: 2, output: 5 },
  "claude-sonnet-5-5": { read: 0.05, write_5m: 1.25, write_1h: 2, output: 5 },
};

// A record holds no prompt text, only its length; desc is stored base64 (UTF-8) so a grep does not hit it.
export const enc = (s) => Buffer.from(String(s ?? ""), "utf8").toString("base64");
export const dec = (s) => (typeof s === "string" ? Buffer.from(s, "base64").toString("utf8") : "");

const one = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return [...t].length > n ? `${[...t].slice(0, n - 1).join("")}…` : t;
};
const rawTokens = (a) => (a.input ?? 0) + (a.read ?? 0) + (a.write_5m ?? 0) + (a.write_1h ?? 0) + (a.output ?? 0);
const LIMIT = 200;
const DESC_MAX = 200;
const COUNTED = ["calls", "input", "read", "write_5m", "write_1h", "output"];
const ROLE_LABEL = { coordinator: "main", commit: "commit", reviewer: "review", ba: "ba", decider: "decider", other: "other" };

// Delta of every agent against the sum of its fields in prior records; peak and largest_result stay cumulative maxima.
function deltaAgents(session, prior) {
  const out = [];
  for (const a of Object.values(session.agents)) {
    const was = Object.fromEntries(COUNTED.map((k) => [k, 0]));
    const wasTools = {};
    for (const r of prior) {
      for (const p of r.agents ?? []) {
        if (p.id !== a.id) continue;
        for (const k of COUNTED) was[k] += p[k] ?? 0;
        for (const [t, n] of Object.entries(p.tools ?? {})) wasTools[t] = (wasTools[t] ?? 0) + n;
      }
    }
    const d = { id: a.id, role: a.role, desc: enc([...String(a.desc ?? "")].slice(0, DESC_MAX).join("")), model: a.model };
    if (a.effort) d.effort = String(a.effort).slice(0, 12);
    for (const k of COUNTED) d[k] = Math.max(0, (a[k] ?? 0) - was[k]);
    d.peak = a.peak ?? 0;
    d.tools = {};
    for (const [t, n] of Object.entries(a.tools ?? {})) {
      const x = n - (wasTools[t] ?? 0);
      if (x > 0) d.tools[t] = x;
    }
    d.largest_result = a.largest_result ?? 0;
    if (a.findings) d.findings = { ...a.findings };
    if (COUNTED.some((k) => d[k] > 0) || Object.keys(d.tools).length) out.push(d);
  }
  return out;
}

// Hash spellings of one commit differ in length (git's abbreviation grows with the repo): a prefix is the same commit.
export const sameCommit = (a, b) => a.startsWith(b) || b.startsWith(a);
// Hashes are at least 7 characters (git's shortest abbreviation), so only one 7-character bucket is compared.
export function uniqueCommits(hashes, same = sameCommit) {
  const out = [];
  const byStem = new Map();
  for (const h of [...hashes].sort((a, b) => b.length - a.length)) {
    const kept = byStem.get(h.slice(0, 7)) ?? [];
    if (kept.some((x) => same(x, h))) continue;
    byStem.set(h.slice(0, 7), [...kept, h]);
    out.push(h);
  }
  return out;
}

export function buildRecord(session, prior, ctx) {
  const agents = deltaAgents(session, prior);
  if (!agents.length) return null;
  const round = session.prompts.length;
  const p = session.prompts[round - 1];
  const last = prior[prior.length - 1];
  const sameRound = last?.round === round;
  const since = Date.parse(sameRound ? last.ts : p?.ts || session.firstTs);
  const seen = prior.flatMap((r) => r.commits ?? []);
  const sessionId = ctx.session ?? prior[0]?.session;
  if (!sessionId) throw new Error("buildRecord: no session id in ctx or prior records");
  const rec = {
    v: 1,
    ts: ctx.now.toISOString(),
    session: sessionId,
    round,
    kit: ctx.kit,
    project: ctx.project,
    user: ctx.user,
    branch: ctx.branch,
  };
  if (p && !prior.some((r) => r.round === round)) rec.prompt_chars = p.chars;
  rec.duration_s = Number.isFinite(since) ? Math.max(0, Math.round((ctx.now.getTime() - since) / 1000)) : 0;
  rec.commits = [...new Set(session.commits.map((c) => c.hash))].filter((h, i, a) => !seen.some((s) => sameCommit(s, h))
    && !a.slice(0, i).some((x) => sameCommit(x, h)));
  if (!prior.length && session.baseContext != null) rec.base_context = session.baseContext;
  rec.agents = agents;
  return rec;
}

const FALLBACK_RATIOS = { read: 0.1, write_5m: 1.25, write_1h: 2, output: 5 };

function byPrefix(model, table) {
  let best = null;
  for (const k of Object.keys(table)) if ((model ?? "").startsWith(k) && (best === null || k.length > best.length)) best = k;
  return best === null ? null : table[best];
}

// Input-equivalent tokens, each token type at its model's ratio to base input.
function units(a) {
  const r = byPrefix(a.model, DEFAULT_RATIOS) ?? FALLBACK_RATIOS;
  return (a.input ?? 0) + r.read * (a.read ?? 0) + r.write_5m * (a.write_5m ?? 0) + r.write_1h * (a.write_1h ?? 0) + r.output * (a.output ?? 0);
}

export function weight(a, prices) {
  const price = byPrefix(a.model, prices);
  return price === null ? null : (price * units(a)) / 1e6;
}

export const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
export const fmtUsd = (x) => `$${x < 100 ? x.toFixed(2) : Math.round(x)}`;

function totals(agents, prices) {
  let usd = 0;
  let priced = false;
  let unpriced = 0;
  for (const a of agents) {
    const w = weight(a, prices);
    if (w === null) unpriced += rawTokens(a);
    else {
      usd += w;
      priced = true;
    }
  }
  return [priced ? fmtUsd(usd) : "", unpriced ? `${fmtTok(unpriced)} tok unpriced` : ""].filter(Boolean).join(" + ") || "$0.00";
}

export const modelShort = (m) => one(String(/opus|sonnet|haiku/.exec(m ?? "")?.[0] ?? (m || "?")), 30);

// money false (config usage.money; a subscription bills no tokens) shows input-equivalent tokens only.
export function summaryLine(rec, sessionRecs, prices, { money = true } = {}) {
  const total = rec.agents.reduce((n, a) => n + units(a), 0);
  const byRole = new Map();
  for (const a of rec.agents) {
    const label = ROLE_LABEL[a.role] ?? "other";
    byRole.set(label, (byRole.get(label) ?? 0) + units(a));
  }
  const split = [...byRole].sort((x, y) => y[1] - x[1]).slice(0, 4)
    .map(([label, u]) => `${label} ${Math.round((100 * u) / (total || 1))}%`).join(" · ");
  let mainPeak = 0;
  for (const r of [...sessionRecs, rec]) for (const a of r.agents) if (a.id === "main") mainPeak = Math.max(mainPeak, a.peak);
  const cost = (a) => weight(a, prices) ?? 0;
  const anyPriced = rec.agents.some((a) => weight(a, prices) !== null);
  const top = [...rec.agents].sort((x, y) => (anyPriced ? cost(y) - cost(x) : units(y) - units(x)))[0];
  const name = (dec(top.desc) || ROLE_LABEL[top.role] || top.id).replace(/\s+/g, " ").trim();
  const sessionAgents = sessionRecs.flatMap((r) => r.agents);
  const sessionEq = fmtTok(sessionAgents.reduce((n, a) => n + units(a), 0));
  // money false: tokens are the amount and always shown; money true: the in-eq is a droppable note after the cost
  const amount = (agents, eq, withEq) => (money ? `${totals(agents, prices)}${withEq ? ` (in-eq ${eq})` : ""}` : `in-eq ${eq}`);
  const build = (n, roundEq, sessionEq_) => `tokens this round ≈ ${amount(rec.agents, fmtTok(total), roundEq)}: ${split}`
    + ` | peak ${Math.round(mainPeak / 1000)}k | top: ${one(name, n)} (${modelShort(top.model)}, ${top.calls} calls,`
    + ` peak ${Math.round(top.peak / 1000)}k) | session ≈ ${amount(sessionAgents, sessionEq, sessionEq_)}`;
  // Cap at 200 code points: shrink desc first, then drop the round's in-eq, the session's last.
  let line = "";
  for (const [min, roundEq, sessEq] of [[8, true, true], [1, false, true], [1, false, false]])
    for (let n = 24; n >= min && !line; n--) if ([...build(n, roundEq, sessEq)].length <= LIMIT) line = build(n, roundEq, sessEq);
  line ||= one(build(1, false, false), LIMIT);
  return line;
}

const CAP = { models: 6, users: 5, projects: 5, roles: 6, roleModels: 3, tools: 5, rounds: 10, kits: 10, outliers: 10, months: 6, mix: 3, rules: 12 };
const PEAK_OUTLIER = 150000;
const CALLS_OUTLIER = 150;
const TYPES = ["input", "read", "write_5m", "write_1h", "output"];

// ---- loading ----

const NUMERIC = ["calls", "input", "read", "write_5m", "write_1h", "output", "peak", "largest_result"];
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

// A record the digest can total without throwing: v 1, string ts, agents are objects with a string model and numeric counts.
export function validRecord(r) {
  if (!isObj(r) || r.v !== 1 || typeof r.ts !== "string" || !Array.isArray(r.agents)) return false;
  if (r.commits !== undefined && !(Array.isArray(r.commits) && r.commits.every((h) => typeof h === "string" && h.length >= 7))) return false;
  return r.agents.every((a) => isObj(a) && typeof a.model === "string" && NUMERIC.every((k) => a[k] === undefined || Number.isFinite(a[k]))
    && (a.tools === undefined || (isObj(a.tools) && Object.values(a.tools).every(Number.isFinite)))
    && (a.findings === undefined || isObj(a.findings)));
}

// bad = a line that is not JSON; skipped = JSON that is not a usable record.
export function loadRecords(usageDir, since = "") {
  const out = { recs: [], bad: 0, skipped: 0 };
  let files = [];
  try {
    // decisions/ holds the decider log (decider.mjs), refusals/ the hook refusals (loadRefusals), not token records
    files = readdirSync(usageDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".jsonl") && !/^(decisions|refusals)[/\\]/.test(f))
      .sort();
  } catch {
    return out;
  }
  // a flush that crashed after writing its file (or an older racing one) leaves the same lines in two files: once each
  const seen = new Set();
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
      if (!validRecord(r)) {
        out.skipped++;
        continue;
      }
      if (typeof r.session === "string") {
        const key = `${r.session}\n${r.ts}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      if (since && !(r.ts >= since)) continue;
      out.recs.push(r);
    }
  }
  return out;
}

// The refusal records of ai/usage/refusals/**: {v:1, ts, rule, kit, branch}; unusable lines are dropped, a line
// flushed twice (a crash between write and cleanup) counts once.
export function loadRefusals(usageDir, since = "") {
  let files = [];
  try {
    files = readdirSync(join(usageDir, "refusals"), { recursive: true }).map(String).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const f of files) {
    let text = "";
    try {
      text = readFileSync(join(usageDir, "refusals", f), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isObj(r) || r.v !== 1 || typeof r.ts !== "string" || typeof r.rule !== "string") continue;
      const key = `${r.ts}\n${r.rule}\n${r.branch}`;
      if (seen.has(key) || (since && !(r.ts >= since))) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

// One in-memory record per local session (whole session, kit "baseline", round = prompt count, prompt_chars = the
// first prompt's length); never written.
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
      const sess = collectSession(path);
      const rec = buildRecord(sess, [], {
        now: statSync(path).mtime, session, kit: "baseline",
        project: who.project ?? "", user: who.user ?? "", branch: who.branch ?? "",
      });
      if (!rec || (since && rec.ts < since)) continue;
      if (sess.prompts.length) rec.prompt_chars = sess.prompts[0].chars;
      else delete rec.prompt_chars;
      out.recs.push(rec);
    } catch {
      out.skipped++;
    }
  }
  return out;
}

// ---- digest ----

const pct = (x, total) => `${total > 0 ? Math.round((100 * x) / total) : 0}%`;
const sum = (xs) => xs.reduce((n, x) => n + x, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);
const top = (map, n) => [...map].sort((x, y) => y[1] - x[1]).slice(0, n);
const bump = (map, k, x) => map.set(k, (map.get(k) ?? 0) + x);
const bySemver = (a, b) => (a === "baseline" ? -1 : b === "baseline" ? 1 : a.localeCompare(b, "en", { numeric: true }));
const nameOf = (s, fallback) => one(s, 20).replace(/\s/g, "_") || fallback;

const max = (xs) => xs.reduce((m, x) => Math.max(m, x), 0);

// Per round (records sharing session#round, summed first): each commit belongs to the earliest round that saw it.
function roundInfoOf(recs, prices) {
  const roundInfo = new Map();
  const owned = new Map();
  for (const r of recs) {
    const e = roundInfo.get(`${r.session}#${r.round}`) ?? { kit: one(r.kit || "?", 20), cost: 0, roles: new Map(), n: 0 };
    for (const a of r.agents) {
      const w = weight(a, prices) ?? 0;
      e.cost += w;
      bump(e.roles, a.role ?? "other", w);
    }
    for (const h of uniqueCommits(r.commits ?? [])) {
      const kept = owned.get(h.slice(0, 7)) ?? [];
      if (kept.some((x) => sameCommit(x, h))) continue;
      owned.set(h.slice(0, 7), [...kept, h]);
      e.n++;
    }
    roundInfo.set(`${r.session}#${r.round}`, e);
  }
  return roundInfo;
}

// meta: bad = unparsable lines, skipped = unusable records, sessionsSkipped = baseline sessions that failed, source "baseline".
export function digest(recs, prices, meta = {}) {
  const base = meta.source === "baseline";
  const usable = recs.filter(validRecord);
  const skipped = (meta.skipped ?? 0) + recs.length - usable.length;
  const extra = [meta.bad ? `${meta.bad} bad lines` : "", skipped ? `${skipped} skipped` : "",
    meta.sessionsSkipped ? `${meta.sessionsSkipped} sessions skipped` : ""].filter(Boolean);
  if (!usable.length) return ["no usage records", ...extra].join(" · ");
  recs = [...usable].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  // One row per agent per record; cost is null for a model with no price.
  const rows = [];
  for (const r of recs) {
    for (const a of r.agents) rows.push({ r, a, role: a.role ?? "other", cost: weight(a, prices), key: `${r.session}/${a.id}`, rk: `${r.session}#${r.round}` });
  }
  const c = (x) => x.cost ?? 0;
  const total = sum(rows.map(c));
  const sessions = new Set(recs.map((r) => r.session));
  const rounds = new Set(recs.map((r) => `${r.session}#${r.round}`));
  const commits = new Set(uniqueCommits(recs.flatMap((r) => r.commits ?? [])));

  // Distinct agents: calls and tools add up across records, peak and largest result are maxima.
  const agents = new Map();
  for (const x of rows) {
    const g = agents.get(x.key) ?? { role: x.role, desc: dec(x.a.desc), model: x.a.model, effort: x.a.effort ?? "", session: x.r.session, user: x.r.user, calls: 0, peak: 0, largest: 0, cost: 0, tools: new Map(), findings: null, kit: x.r.kit };
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
  out.push((base
    ? [`baseline: 1 record = 1 session`, `records ${recs.length}`, `commits ${commits.size}`, range]
    : [`records ${recs.length}`, `sessions ${sessions.size}`, `rounds ${rounds.size}`, `commits ${commits.size}`, range]).concat(extra).join(" · "));

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
    out.push(`unpriced: ${fmtTok(sum([...unpriced.values()]))} tok (${u.map(([k]) => k).join(", ")}${unpriced.size > 3 ? ", …" : ""})`);
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
  out.push(commits.size ? `all cost / commits ≈ ${fmtUsd(total / commits.size)} (commits ${commits.size}, total ${fmtUsd(total)}, unpriced tokens excluded)` : "all cost / commits: none (commits 0)");
  if (!base) out.push(`per round ≈ ${fmtUsd(total / rounds.size)} (rounds ${rounds.size})`);
  out.push(`per session ≈ ${fmtUsd(total / sessions.size)} (sessions ${sessions.size})`);

  const roundInfo = roundInfoOf(recs, prices);
  const perCommit = (cost, n) => (cost > 0 ? fmtUsd(cost / n) : "unpriced");
  if (!base) {
    out.push("## by commits per round");
    const BUCKETS = [["0", (n) => n === 0], ["1", (n) => n === 1], ["2-3", (n) => n >= 2 && n <= 3], ["4-7", (n) => n >= 4 && n <= 7], ["8+", (n) => n >= 8]];
    for (const [label, inB] of BUCKETS) {
      const rs2 = [...roundInfo.values()].filter((e) => inB(e.n));
      if (!rs2.length) continue;
      const cost = sum(rs2.map((e) => e.cost));
      const n = sum(rs2.map((e) => e.n));
      const role = (k) => pct(sum(rs2.map((e) => e.roles.get(k) ?? 0)), cost);
      out.push(`${label} commits: ${rs2.length} rounds · ${fmtUsd(cost)} · ${n} commits · ${label === "0" ? `${pct(cost, total)} of cost`
        : `cost/commit ${perCommit(cost, n)}`} · reviewer ${role("reviewer")} · coordinator ${role("coordinator")} · commit ${role("commit")}`);
    }
    out.push("commits are the hashes seen in this repo's session transcripts; a sibling clone's commits are in its own records");
  }

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
    const cm = new Set(uniqueCommits(rr.flatMap((r) => r.commits ?? [])));
    const share = (f) => pct(sum(kr.filter(f).map((x) => x.cost)), cost);
    const mine = [...agents.values()].filter((g) => g.kit === k);
    const cAgents = mine.filter((g) => g.role === "commit");
    const mains = mine.filter((g) => g.role === "coordinator");
    const parts = [base ? `${s.size}s` : `${s.size}s ${rd.size}r`, fmtUsd(cost), base ? `${fmtUsd(cost / s.size)}/session` : `${fmtUsd(cost / rd.size)}/round`,
      cm.size ? `cost/commits ${fmtUsd(cost / cm.size)}` : "no commits",
      `commit ${share((x) => x.a.role === "commit")}`, `opus ${share((x) => modelShort(x.a.model) === "opus")}`];
    if (cAgents.length) parts.push(`commit calls ${Math.round(mean(cAgents.map((g) => g.calls)))}`);
    if (mains.length) parts.push(`main peak ${fmtTok(mean(mains.map((g) => g.peak)))}`);
    const revs = mine.filter((g) => g.role === "reviewer" && g.findings);
    if (revs.length) {
      const per = (f) => (Math.round((10 * sum(revs.map((g) => g.findings[f] ?? 0))) / revs.length) / 10).toString();
      parts.push(`${revs.length} reviews ${per("confirmed")} confirmed/review ${per("plausible")} plausible/review`);
    }
    if (!base) {
      const mineR = [...roundInfo.values()].filter((e) => e.kit === k);
      const withC = mineR.filter((e) => e.n > 0);
      if (withC.length) parts.push(`commit rounds cost/commit ${perCommit(sum(withC.map((e) => e.cost)), sum(withC.map((e) => e.n)))}`);
      parts.push(`no-commit rounds ${pct(sum(mineR.filter((e) => e.n === 0).map((e) => e.cost)), sum(mineR.map((e) => e.cost)))} of cost`);
    }
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
    out.push(`${one(role, 20)}: ${e.list.length} agents · calls mean ${Math.round(mean(e.list.map((g) => g.calls)))} max ${max(e.list.map((g) => g.calls))}`
      + ` · peak mean ${fmtTok(mean(e.list.map((g) => g.peak)))} max ${fmtTok(max(e.list.map((g) => g.peak)))}`
      + ` · ${fmtUsd(e.cost / e.list.length)}/agent · largest result ${fmtTok(max(e.list.map((g) => g.largest)))}${tools ? ` · tools ${tools}` : ""}`);
  }
  const months = new Map();
  for (const r of recs) if (Number.isFinite(r.base_context)) (months.get(r.ts.slice(0, 7)) ?? months.set(r.ts.slice(0, 7), []).get(r.ts.slice(0, 7))).push(r.base_context);
  if (months.size) out.push(`base context: ${[...months].sort().slice(-CAP.months).map(([m, v]) => `${m} ${fmtTok(mean(v))}`).join(" · ")}`);

  // reviewer findings per model
  out.push("## reviews");
  const rev = new Map();
  for (const g of agents.values()) {
    if (g.role !== "reviewer" || !g.findings) continue;
    const key = g.effort ? `${modelShort(g.model)} ${one(g.effort, 12)}` : modelShort(g.model);
    const e = rev.get(key) ?? { n: 0, confirmed: 0, plausible: 0, cost: 0 };
    e.n++;
    e.confirmed += g.findings.confirmed ?? 0;
    e.plausible += g.findings.plausible ?? 0;
    e.cost += g.cost;
    rev.set(key, e);
  }
  if (!rev.size) out.push("none");
  for (const [m, e] of [...rev].sort((a, b) => b[1].n - a[1].n).slice(0, CAP.models)) {
    const per = (x) => (Math.round((10 * x) / e.n) / 10).toString();
    out.push(`${m}: ${e.n} reviews, ${per(e.confirmed)} confirmed/review, ${per(e.plausible)} plausible/review, ${fmtUsd(e.cost / e.n)}/review`);
  }

  // hook refusals, per rule and per kit; only for the API's records, not a baseline
  if (meta.refusals) {
    out.push("## refusals");
    const byRule = new Map();
    const byKit = new Map();
    for (const r of meta.refusals) {
      bump(byRule, one(r.rule, 40), 1);
      bump(byKit, one(r.kit || "?", 20), 1);
    }
    if (!byRule.size) out.push("none");
    else {
      out.push(`${meta.refusals.length} refusals · per rule: ${top(byRule, CAP.rules).map(([k, n]) => `${k} ${n}`).join(", ")}${byRule.size > CAP.rules ? `, +${byRule.size - CAP.rules}` : ""}`);
      out.push(`per kit: ${[...byKit].sort((a, b) => bySemver(a[0], b[0])).slice(-CAP.kits).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    }
  }

  // costliest rounds (a round's records are summed); in baseline one record is a whole session
  out.push(base ? "## costliest sessions" : "## costliest rounds");
  const rds = new Map();
  for (const x of rows) {
    const e = rds.get(x.rk) ?? { cost: 0, session: x.r.session, round: x.r.round, user: x.r.user, chars: null, roles: new Map() };
    e.cost += c(x);
    e.chars ??= Number.isFinite(x.r.prompt_chars) ? x.r.prompt_chars : null;
    bump(e.roles, x.role, c(x));
    rds.set(x.rk, e);
  }
  const costly = [...rds.values()].filter((e) => e.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, CAP.rounds);
  if (!costly.length) out.push("none");
  for (const e of costly) {
    const mix = top(e.roles, CAP.mix).filter(([, v]) => v > 0).map(([k, v]) => `${one(k, 12)} ${pct(v, e.cost)}`).join(" ");
    out.push(`- ${fmtUsd(e.cost)} ${String(e.session).slice(0, 8)} ${base ? `${e.round}p` : `r${e.round}`}${e.chars === null ? "" : ` ${e.chars} chars`} ${nameOf(e.user, "anon")}: ${mix}`);
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

// ---- compare ----

const kitMatches = (kit, v) => kit === v || String(kit).startsWith(`${v}.`);

// The metrics of the records of one kit version (a prefix matches all its patches); null for a metric with no base.
function kitMetrics(recs, refusals, prices) {
  const rounds = roundInfoOf(recs, prices);
  const cost = sum([...rounds.values()].map((e) => e.cost));
  const commits = new Set(uniqueCommits(recs.flatMap((r) => r.commits ?? []))).size;
  const agents = new Map();
  for (const r of recs) {
    for (const a of r.agents) {
      const g = agents.get(`${r.session}/${a.id}`) ?? { role: a.role ?? "other", calls: 0, peak: 0, readGrep: 0, findings: null };
      g.calls += a.calls ?? 0;
      g.peak = Math.max(g.peak, a.peak ?? 0);
      g.readGrep += (a.tools?.Read ?? 0) + (a.tools?.Grep ?? 0);
      if (a.findings) g.findings = a.findings;
      agents.set(`${r.session}/${a.id}`, g);
    }
  }
  const all = [...agents.values()];
  const mains = all.filter((g) => g.role === "coordinator");
  const revs = all.filter((g) => g.role === "reviewer" && g.findings);
  const ratio = (x, n) => (n > 0 ? x / n : null);
  return {
    sessions: new Set(recs.map((r) => r.session)).size,
    rounds: rounds.size,
    "cost/round": ratio(cost, rounds.size),
    "cost/commit": cost > 0 ? ratio(cost, commits) : null,
    "main peak": mains.length ? mean(mains.map((g) => g.peak)) : null,
    "Read+Grep/round": ratio(sum(all.map((g) => g.readGrep)), rounds.size),
    "committer calls/commit": ratio(sum(all.filter((g) => g.role === "commit").map((g) => g.calls)), commits),
    "confirmed/review": ratio(sum(revs.map((g) => g.findings.confirmed ?? 0)), revs.length),
    "plausible/review": ratio(sum(revs.map((g) => g.findings.plausible ?? 0)), revs.length),
    "refusals/commit": ratio(refusals.length, commits),
  };
}

const FMT = { "cost/round": fmtUsd, "cost/commit": fmtUsd, "main peak": fmtTok };
const cell = (k, v) => (v === null ? "n/a" : (FMT[k] ?? ((x) => String(Math.round(x * 100) / 100)))(v));
const change = (a, b) => (a === null || b === null || a === 0 ? "n/a" : `${b >= a ? "+" : ""}${Math.round((100 * (b - a)) / a)}%`);

// Two kit versions side by side from the same records the `## by kit` section reads, with the change in %.
export function compare(recs, refusals, prices, kitA, kitB) {
  const usable = recs.filter(validRecord);
  const known = [...new Set(usable.map((r) => String(r.kit || "?")))].sort(bySemver);
  const missing = [kitA, kitB].filter((v) => !usable.some((r) => kitMatches(r.kit, v)));
  if (missing.length) return `unknown kit version ${missing.map((v) => one(v, 20)).join(", ")}: no records; known: ${known.slice(-CAP.kits).join(", ") || "none"}`;
  const side = (v) => kitMetrics(usable.filter((r) => kitMatches(r.kit, v)), refusals.filter((r) => kitMatches(r.kit, v)), prices);
  const [a, b] = [side(kitA), side(kitB)];
  const out = [`compare kit ${one(kitA, 20)} vs ${one(kitB, 20)} · metric: ${one(kitA, 20)} | ${one(kitB, 20)} | change`];
  for (const k of Object.keys(a)) out.push(`${k}: ${cell(k, a[k])} | ${cell(k, b[k])} | ${change(a[k], b[k])}`);
  out.push("commits and costs are per kit's own records; a prefix such as 2.45 covers all its patches");
  return out.join("\n");
}
