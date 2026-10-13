import { TEXT_RULES, METADATA_RULES, RULE_VERSION, CONFIG_ID, THRESHOLDS, BRANCH_MAX, SHORTENERS, FREE_EMAIL, DUPLICATE_MESSAGE } from "./risk-rules.js";
import { domainOf, registrableDomain, pslVersion } from "./domains.js";
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
export function tierFor(score, boundaries = [THRESHOLDS.uncertain, THRESHOLDS.elevated]) {
  return score >= boundaries[1] ? "elevated" : score >= boundaries[0] ? "uncertain" : "low";
}
const normaliseBranch = (evidence, max) => clamp(Math.round(5 + 95 * Math.min(evidence, max) / max), 5, 100);
function assertScoreable(page) {
  if (page.extractionStatus !== "reliable" || ["unsupported", "extraction-limited"].includes(page.pageStatus)) {
    throw new Error("Unable to reliably identify the job advertisement content.");
  }
}
// Versioned display/context guard: quoted phrases, negation and employer scam warnings
// are context only. Required boundary tests precede any independent validity claim.
function cueMatch(text, rule) {
  const pattern = new RegExp(rule.pattern.source, "gi");
  for (const match of text.matchAll(pattern)) {
    const start = Math.max(text.lastIndexOf(".", match.index - 1), text.lastIndexOf("!", match.index - 1), text.lastIndexOf("\n", match.index - 1)) + 1;
    const endCandidates = [text.indexOf(".", match.index + match[0].length), text.indexOf("!", match.index + match[0].length), text.indexOf("\n", match.index + match[0].length)].filter(i => i >= 0);
    const end = endCandidates.length ? Math.min(...endCandidates) : text.length;
    const sentence = text.slice(start, end);
    const prefix = text.slice(start, match.index);
    const quoted = [...text.matchAll(/["“][^"”\n]*["”]/g)].some(q => q.index <= match.index && q.index + q[0].length >= match.index + match[0].length);
    if (quoted || /\b(?:scam|fraud|beware|avoid|warning|prohibit)\b/i.test(sentence) ||
        /\b(?:never|do not|does not|don't|doesn't|not required|not request|not charge|no need to)\b/i.test(prefix) ||
        /\bnot required\b/i.test(sentence) || /\bno\s*$/i.test(prefix) || /\b(?:employer|company|we)\b.{0,30}\b(?:pays?|covers?|provides?)\b/i.test(prefix)) continue;
    return match[0];
  }
  return null;
}
function result(model, score, evidenceSum, reasons, page) {
  return { schemaVersion: 1, model, configId: CONFIG_ID, ruleVersion: RULE_VERSION, pslVersion,
    score, tier: tierFor(score), evidenceSum,
    ExtractionSufficiency: Math.round(100 * clamp(Number(page.extractionQuality || 0), 0, 1)),
    TierBoundaryDistance: Math.round(100 * Math.min(Math.abs(score - 30), Math.abs(score - 60), 30) / 30),
    reasons, scoredReasons: reasons.filter(r => r.role === "scored"),
    contextReasons: reasons.filter(r => r.role === "context"), uncertaintyReasons: reasons.filter(r => r.role === "uncertainty") };
}
export function scoreTextOnly(page) {
  assertScoreable(page);
  const text = [page.title, page.companyText, page.visibleText].filter(Boolean).join("\n").normalize("NFKC").replace(/[\t\r ]+/g, " ");
  const reasons = []; let evidence = 0;
  for (const rule of TEXT_RULES) {
    const match = cueMatch(text, rule);
    if (match) { evidence += rule.points; reasons.push({ id: rule.id, points: rule.points, role: "scored", message: rule.reason, source: "text", evidence: match }); }
  }
  if ((page.visibleText || "").length < 350) reasons.push({ id: "TXT_LIMITED", points: 0, role: "uncertainty", message: "Limited listing text is available; this is not risk evidence.", source: "text" });
  return result("text-only", normaliseBranch(evidence, BRANCH_MAX.text), evidence, reasons, page);
}
export function scoreMetadataOnly(page) {
  assertScoreable(page);
  const pageRoot = registrableDomain(domainOf(page.url));
  const apps = [...new Set((page.applicationLinks || []).map(domainOf).map(registrableDomain).filter(Boolean))];
  const external = [...new Set((page.externalLinks || []).map(domainOf).map(registrableDomain).filter(Boolean))];
  const providers = [].concat(page.emailProvider || []);
  const predicates = {
    META_INSECURE: page.protocol === "http:", META_SHORTENER: apps.some(d => SHORTENERS.has(d)),
    META_EXTERNAL_APP: !!pageRoot && apps.some(d => d !== pageRoot), META_PUBLIC_EMAIL: providers.some(d => FREE_EMAIL.has(d)),
    META_MESSAGING: (page.contactCues || []).some(c => ["whatsapp", "telegram", "wechat", "signal"].includes(c)),
    META_MANY_DOMAINS: external.length >= 8, META_EXTRACTION_LOW: page.extractionQuality < 0.45
  };
  const reasons = METADATA_RULES.filter(r => predicates[r.id]).map(r => ({ id: r.id, points: r.points, role: r.role, message: r.reason, source: "metadata" }));
  const evidence = reasons.reduce((sum, r) => sum + r.points, 0);
  return result("metadata-only", normaliseBranch(evidence, BRANCH_MAX.metadata), evidence, reasons, page);
}
export function fuse(text, metadata, page, textWeight = 0.5, boundaries = [30, 60], scaling = "normalised") {
  const t = scaling === "raw-evidence" ? Math.min(100, 5 + text.evidenceSum) : text.score;
  const m = scaling === "raw-evidence" ? Math.min(100, 5 + metadata.evidenceSum) : metadata.score;
  const score = clamp(Math.round(textWeight * t + (1 - textWeight) * m));
  const reasons = [...text.reasons, ...metadata.reasons].filter(r => !(r.id === "META_MESSAGING" && text.reasons.some(t => t.id === "TXT_OFFPLATFORM")));
  const out = result("multi-signal", score, null, reasons, page);
  out.tier = tierFor(score, boundaries); out.components = { textScore: text.score, metadataScore: metadata.score, textEvidence: text.evidenceSum, metadataEvidence: metadata.evidenceSum };
  return out;
}
export function scoreMultiSignal(page) { return fuse(scoreTextOnly(page), scoreMetadataOnly(page), page); }
export function scoreAll(page) {
  const textOnly = scoreTextOnly(page), metadataOnly = scoreMetadataOnly(page);
  return { textOnly, metadataOnly, multiSignal: fuse(textOnly, metadataOnly, page),
    sensitivities: { priorWeight: fuse(textOnly, metadataOnly, page, 0.58),
      rawScaling: fuse(textOnly, metadataOnly, page, 0.5, [30, 60], "raw-evidence"),
      lowerBoundaries: fuse(textOnly, metadataOnly, page, 0.5, [25, 55]),
      upperBoundaries: fuse(textOnly, metadataOnly, page, 0.5, [35, 65]) } };
}
export function combineBackend(local, backend) {
  if (!backend || backend.schemaVersion !== 1 || !["completed", "unavailable"].includes(backend.status) ||
      !Number.isInteger(backend.duplicateSourceCount) || backend.duplicateSourceCount < 0 || !Array.isArray(backend.contextReasons) ||
      backend.contextReasons.some(r => r.id !== "CTX_CROSS_DOMAIN_DUPLICATE" || r.points !== 0 || r.role !== "context" || r.message !== DUPLICATE_MESSAGE) ||
      (backend.contextReasons.length && backend.duplicateSourceCount < 3)) throw new Error("Invalid corroboration response.");
  return { ...local, model: "full-workflow", backend };
}
export const scoringInternals = { domainOf, registrableDomain, tierFor, normaliseBranch, cueMatch };
