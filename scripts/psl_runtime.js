const exact = new Set(rules.filter(r => !r.startsWith("!") && !r.startsWith("*.")));
const exceptions = new Set(rules.filter(r => r.startsWith("!")).map(r => r.slice(1)));
const wildcards = new Set(rules.filter(r => r.startsWith("*.")).map(r => r.slice(2)));
function domainOf(value) {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/\.$/, "") : ""; } catch { return ""; }
}
function registrableDomain(value) {
  const host = domainOf("https://" + value);
  if (!host || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return "";
  const parts = host.split("."); let suffix = 1;
  for (let i = 0; i < parts.length; i++) {
    const tail = parts.slice(i).join(".");
    if (exceptions.has(tail)) { suffix = parts.length - i - 1; break; }
    if (exact.has(tail)) suffix = Math.max(suffix, parts.length - i);
    if (i > 0 && wildcards.has(tail)) suffix = Math.max(suffix, parts.length - i + 1);
  }
  return parts.length > suffix ? parts.slice(-suffix - 1).join(".") : "";
}
globalThis.CGDomain = Object.freeze({ domainOf, registrableDomain, pslVersion: __PSL_VERSION__ });
})();
