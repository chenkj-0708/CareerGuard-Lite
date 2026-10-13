const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

import { TEXT_RULES, RULE_VERSION, METADATA_WEIGHTS, THRESHOLDS } from "./risk-rules.js";

const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "cutt.ly", "rb.gy"]);
const FREE_EMAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "proton.me", "protonmail.com"]);

function domainOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function registrableApprox(domain) {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length <= 2) return domain;
  const compound = new Set(["com.my", "com.sg", "com.au", "co.uk", "co.nz", "co.jp"]);
  const tail2 = parts.slice(-2).join(".");
  return compound.has(tail2) ? parts.slice(-3).join(".") : tail2;
}

function tierFor(score) {
  if (score >= THRESHOLDS.elevated) return "elevated";
  if (score >= THRESHOLDS.uncertain) return "uncertain";
  return "low";
}

function confidenceFor(score, coverage) {
  const boundaryDistance = Math.min(Math.abs(score - 30), Math.abs(score - 60), 30) / 30;
  return clamp(Math.round(45 + coverage * 35 + boundaryDistance * 20));
}

function uniqueReasons(reasons) {
  const seen = new Set();
  return reasons.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function scoreTextOnly(page) {
  const text = [page.title, page.companyText, page.visibleText].filter(Boolean).join("\n");
  const reasons = [];
  let score = 5;

  for (const rule of TEXT_RULES) {
    const match = text.match(rule.pattern);
    if (match) {
      score += rule.points;
      reasons.push({ id: rule.id, points: rule.points, message: rule.reason, source: "text", evidence: match[0] });
    }
  }

  if ((page.visibleText || "").length < 350) {
    score += METADATA_WEIGHTS.limited_text;
    reasons.push({ id: "limited_text", points: METADATA_WEIGHTS.limited_text, message: "Very little job information was available for assessment.", source: "text" });
  }

  score = clamp(score);
  const coverage = clamp((page.visibleText || "").length / 2500, 0, 1);
  return { model: "text-only", ruleVersion: RULE_VERSION, score, tier: tierFor(score), confidence: confidenceFor(score, coverage), reasons: uniqueReasons(reasons) };
}

export function scoreMetadataOnly(page) {
  const reasons = [];
  let score = 5;
  const pageDomain = domainOf(page.url);
  const pageRoot = registrableApprox(pageDomain);
  const applicationDomains = (page.applicationLinks || []).map(domainOf).filter(Boolean);
  const externalDomains = [...new Set((page.externalLinks || []).map(domainOf).filter(Boolean))];

  if (!pageDomain || page.protocol !== "https:") {
    score += METADATA_WEIGHTS.insecure_or_invalid_page;
    reasons.push({ id: "insecure_or_invalid_page", points: METADATA_WEIGHTS.insecure_or_invalid_page, message: "The listing page is not using a normal secure HTTPS address.", source: "metadata" });
  }
  if (applicationDomains.some((domain) => SHORTENERS.has(domain))) {
    score += METADATA_WEIGHTS.shortened_application_link;
    reasons.push({ id: "shortened_application_link", points: METADATA_WEIGHTS.shortened_application_link, message: "The application uses a shortened link that hides its destination.", source: "metadata" });
  }
  const unrelatedApps = applicationDomains.filter((domain) => registrableApprox(domain) !== pageRoot);
  if (unrelatedApps.length > 0) {
    score += METADATA_WEIGHTS.external_application_domain;
    reasons.push({ id: "external_application_domain", points: METADATA_WEIGHTS.external_application_domain, message: "The application link leads to a different domain.", source: "metadata" });
  }
  if ((page.emails || []).some((email) => FREE_EMAIL.has(email.split("@").pop()?.toLowerCase()))) {
    score += METADATA_WEIGHTS.free_email_contact;
    reasons.push({ id: "free_email_contact", points: METADATA_WEIGHTS.free_email_contact, message: "A public email service is used for recruitment contact.", source: "metadata" });
  }
  if ((page.contactCues || []).length > 0) {
    score += METADATA_WEIGHTS.messaging_contact;
    reasons.push({ id: "messaging_contact", points: METADATA_WEIGHTS.messaging_contact, message: "The page contains off-platform messaging contact cues.", source: "metadata" });
  }
  if (externalDomains.length >= 8) {
    score += METADATA_WEIGHTS.many_external_domains;
    reasons.push({ id: "many_external_domains", points: METADATA_WEIGHTS.many_external_domains, message: "The page links to many different external domains.", source: "metadata" });
  }
  if ((page.extractionQuality || 0) < 0.45) {
    score += METADATA_WEIGHTS.extraction_uncertainty;
    reasons.push({ id: "extraction_uncertainty", points: METADATA_WEIGHTS.extraction_uncertainty, message: "The page could not be extracted reliably.", source: "metadata" });
  }

  score = clamp(score);
  const metadataCount = [pageDomain, page.title, ...(page.links || [])].filter(Boolean).length;
  const coverage = clamp(metadataCount / 8, 0, 1);
  return { model: "metadata-only", ruleVersion: RULE_VERSION, score, tier: tierFor(score), confidence: confidenceFor(score, coverage), reasons: uniqueReasons(reasons) };
}

export function scoreMultiSignal(page) {
  const text = scoreTextOnly(page);
  const metadata = scoreMetadataOnly(page);
  const sharedSignals = text.reasons.length > 0 && metadata.reasons.length > 0 ? 8 : 0;
  const score = clamp(Math.round(text.score * 0.58 + metadata.score * 0.42 + sharedSignals));
  const reasons = uniqueReasons([...text.reasons, ...metadata.reasons]).sort((a, b) => b.points - a.points).slice(0, 5);
  return {
    model: "multi-signal", ruleVersion: RULE_VERSION,
    score,
    tier: tierFor(score),
    confidence: Math.round((text.confidence + metadata.confidence) / 2),
    reasons,
    components: { textScore: text.score, metadataScore: metadata.score }
  };
}

export function scoreAll(page) {
  if (page.extractionStatus && page.extractionStatus !== "reliable") throw new Error("Unable to reliably identify the job advertisement content.");
  return {
    textOnly: scoreTextOnly(page),
    metadataOnly: scoreMetadataOnly(page),
    multiSignal: scoreMultiSignal(page)
  };
}

export function combineBackend(localResult, backendResult) {
  if (!backendResult || backendResult.schemaVersion !== 2 || !backendResult.checks || Array.isArray(backendResult.checks) ||
      Object.keys(backendResult.checks).length === 0 ||
      Object.keys(backendResult.checks).some(name => !["rdap_domain_registration", "website_reachable", "contact_domain_match"].includes(name)) ||
      Object.values(backendResult.checks).some(check => !check ||
        !["supported", "contradicted", "unavailable", "inconclusive"].includes(check.status))) {
    throw new Error("Invalid external corroboration response.");
  }
  return { ...localResult, model: "full-workflow", backend: backendResult, ruleVersion: RULE_VERSION };
}

export const scoringInternals = { domainOf, registrableApprox, tierFor };
