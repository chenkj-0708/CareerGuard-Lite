export const HASH_CONTRACT_VERSION = "HashNormalise-CORR-v1";
export function hashNormalise(text) { return String(text || "").normalize("NFKC").toLowerCase().replace(/[\p{White_Space}\uFEFF]+/gu, " ").trim(); }
export function excerptForHash(text) {
  const chars = Array.from(String(text || ""));
  return chars.length > 5000 ? chars.slice(0, 2500).join("") + chars.slice(-2500).join("") : chars.join("");
}
export async function excerptHash(text) {
  const bytes = new TextEncoder().encode(hashNormalise(excerptForHash(text)));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}
