// Masks secrets in a prompt, then cuts it to max code points; mask first so a cut never leaves a secret prefix.
const M = "[masked]";

const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, M],
  [/(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|gh[pous]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[bp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})/g, M],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, M],
  [/(\bBearer\s+)[\w.~+/=-]+/gi, `$1${M}`],
  [/((?:password|secret|token|api[-_]?key)\w*["']?\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|["']?[^\s"']+)/gi, `$1${M}`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)\S*@/gi, `$1${M}@`],
  [/[A-Za-z0-9+/=]{40,}/g, M],
];

export function maskPrompt(text, max = 1000) {
  let s = String(text);
  for (const [re, to] of RULES) s = s.replace(re, to);
  return [...s].slice(0, max).join("");
}
