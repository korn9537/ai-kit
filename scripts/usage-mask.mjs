// Masks secrets in a prompt, then cuts it to max code points; mask first so a cut never leaves a secret prefix.
// The input is capped at PRE_CAP code points first (a stop's time budget), backing off to a word edge.
const M = "[masked]";
const PRE_CAP = 20000;
const MARGIN = 200;

const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, M],
  [/(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|gh[pous]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[bp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{36}|[sr]k_live_[A-Za-z0-9]{10,})/g, M],
  [/(?<!\d)\d{8,10}:AA[\w-]{30,}/g, M],
  [/(\bdiscord(?:app)?\.com\/api\/webhooks\/\d+\/)[\w-]+/gi, `$1${M}`],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, M],
  [/(\bAuthorization:\s*Basic\s+)[\w.~+/=-]+/gi, `$1${M}`],
  [/(\bBearer\s+)[\w.~+/=-]+/gi, `$1${M}`],
  [/((?:password|secret|token|api[-_ ]?key|access[-_ ]?key)\w*["']?\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|["']?[^\s"']+)/gi, `$1${M}`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)\S*@/gi, `$1${M}@`],
  [/[A-Za-z0-9+/=]{40,}/g, M],
];

function capInput(text) {
  const s = String(text);
  const cps = [...s.slice(0, PRE_CAP * 2)];
  if (cps.length <= PRE_CAP && s.length <= PRE_CAP * 2) return s;
  const head = cps.slice(0, PRE_CAP);
  let end = head.length;
  while (end > head.length - MARGIN && !/\s/.test(head[end - 1])) end--;
  return head.slice(0, end > head.length - MARGIN ? end : head.length - MARGIN).join("");
}

export function maskPrompt(text, max = 1000) {
  let s = capInput(text);
  for (const [re, to] of RULES) s = s.replace(re, to);
  return [...s].slice(0, max).join("");
}
