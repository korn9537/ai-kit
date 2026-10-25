// Turns cumulative session totals into a per-round delta record and the one-line summary shown to the user.
// Prices are base input $/MTok by model id prefix; records carry no cost, so a price change re-prices old records.
import { maskPrompt } from "./usage-mask.mjs";

export const DEFAULT_PRICES = {
  "claude-opus-5-5": 4,
  "claude-sonnet-5-5": 2,
};

const COUNTED = ["calls", "input", "read", "write_5m", "write_1h", "output"];
const NOTICE = ' · prompts are recorded in ai/usage/ (set "usage": {"prompts": "none"} in ai/kit/config.json to stop)';
const ROLE_LABEL = { coordinator: "main", commit: "commit", reviewer: "review", ba: "ba", other: "other" };

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
    const d = { id: a.id, role: a.role, desc: a.desc, model: a.model };
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

export function buildRecord(session, prior, ctx) {
  const agents = deltaAgents(session, prior);
  if (!agents.length) return null;
  const round = session.prompts.length;
  const p = session.prompts[round - 1];
  const since = Date.parse(p?.ts || session.firstTs);
  const seen = new Set(prior.flatMap((r) => r.commits ?? []));
  const rec = {
    v: 1,
    ts: ctx.now.toISOString(),
    session: ctx.session ?? prior[0]?.session ?? "",
    round,
    kit: ctx.kit,
    project: ctx.project,
    user: ctx.user,
    branch: ctx.branch,
  };
  if (p && ctx.prompts !== "none") rec.prompt = maskPrompt(p.text);
  rec.duration_s = Number.isFinite(since) ? Math.max(0, Math.round((ctx.now.getTime() - since) / 1000)) : 0;
  rec.commits = session.commits.map((c) => c.hash).filter((h) => !seen.has(h));
  if (!prior.length && session.baseContext != null) rec.base_context = session.baseContext;
  rec.agents = agents;
  return rec;
}

// Input-equivalent tokens: cache reads 0.1x, 5m writes 1.25x, 1h writes 2x, output 5x.
const units = (a) => (a.input ?? 0) + 0.1 * (a.read ?? 0) + 1.25 * (a.write_5m ?? 0) + 2 * (a.write_1h ?? 0) + 5 * (a.output ?? 0);
const rawTokens = (a) => (a.input ?? 0) + (a.read ?? 0) + (a.write_5m ?? 0) + (a.write_1h ?? 0) + (a.output ?? 0);

function priceOf(model, prices) {
  let best = null;
  for (const k of Object.keys(prices)) if ((model ?? "").startsWith(k) && (best === null || k.length > best.length)) best = k;
  return best === null ? null : prices[best];
}

export function weight(a, prices) {
  const price = priceOf(a.model, prices);
  return price === null ? null : (price * units(a)) / 1e6;
}

const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const fmtUsd = (x) => `$${x < 100 ? x.toFixed(2) : Math.round(x)}`;

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

const modelShort = (m) => /opus|sonnet|haiku/.exec(m ?? "")?.[0] ?? (m || "?");
const clip = (s, n) => ([...s].length > n ? `${[...s].slice(0, n - 1).join("")}…` : s);

export function summaryLine(rec, sessionRecs, prices, firstInRepo) {
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
  const desc = clip(top.desc || ROLE_LABEL[top.role] || top.id, 24);
  const line = `tokens this round ≈ ${totals(rec.agents, prices)} (in-eq ${fmtTok(total)}): ${split} | context ${Math.round(mainPeak / 1000)}k`
    + ` | top: ${desc} (${modelShort(top.model)}, ${top.calls} calls, peak ${Math.round(top.peak / 1000)}k)`
    + ` | session ≈ ${totals(sessionRecs.flatMap((r) => r.agents), prices)}`;
  return firstInRepo ? line + NOTICE : line;
}
