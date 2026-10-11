const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const TEXT_RULES = [
  { id: "advance_fee", points: 30, pattern: /\b(pay|payment|fee|deposit|training fee|registration fee|processing fee|purchase equipment)\b/i, reason: "The listing may request money or an advance payment." },
  { id: "sensitive_information", points: 20, pattern: /\b(bank account|credit card|passport|identity card|social security|otp|one[- ]time password)\b/i, reason: "The listing may request sensitive personal or financial information." },
  { id: "pressure_language", points: 12, pattern: /\b(urgent hiring|act now|immediate start|limited slots|respond immediately|today only)\b/i, reason: "The listing uses pressure or unusual urgency." },
  { id: "off_platform_contact", points: 15, pattern: /\b(whatsapp|telegram|signal app|wechat|contact via chat|message me directly)\b/i, reason: "The listing encourages off-platform messaging." },
  { id: "unrealistic_income", points: 16, pattern: /\b(guaranteed income|earn \$?\d+[k,]? (?:daily|per day)|no experience.{0,25}high (?:pay|salary)|get rich|unlimited earnings)\b/i, reason: "The income claim may be unrealistic or guaranteed." },
  { id: "minimal_screening", points: 8, pattern: /\b(no interview|hired immediately|no resume required|no experience required)\b/i, reason: "The recruitment process appears to use very limited screening." }
];

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
  if (score >= 60) return "elevated";
  if (score >= 30) return "uncertain";
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
    if (rule.pattern.test(text)) {
      score += rule.points;
      reasons.push({ id: rule.id, points: rule.points, message: rule.reason, source: "text" });
    }
  }

  if ((page.visibleText || "").length < 350) {
    score += 10;
    reasons.push({ id: "limited_text", points: 10, message: "Very little job information was available for assessment.", source: "text" });
  }

  score = clamp(score);
  const coverage = clamp((page.visibleText || "").length / 2500, 0, 1);
  return { model: "text-only", score, tier: tierFor(score), confidence: confidenceFor(score, coverage), reasons: uniqueReasons(reasons) };
}

export function scoreMetadataOnly(page) {
  const reasons = [];
  let score = 5;
  const pageDomain = domainOf(page.url);
  const pageRoot = registrableApprox(pageDomain);
  const applicationDomains = (page.applicationLinks || []).map(domainOf).filter(Boolean);
  const externalDomains = [...new Set((page.externalLinks || []).map(domainOf).filter(Boolean))];

  if (!pageDomain || page.protocol !== "https:") {
    score += 18;
    reasons.push({ id: "insecure_or_invalid_page", points: 18, message: "The listing page is not using a normal secure HTTPS address.", source: "metadata" });
  }
  if (applicationDomains.some((domain) => SHORTENERS.has(domain))) {
    score += 25;
    reasons.push({ id: "shortened_application_link", points: 25, message: "The application uses a shortened link that hides its destination.", source: "metadata" });
  }
  const unrelatedApps = applicationDomains.filter((domain) => registrableApprox(domain) !== pageRoot);
  if (unrelatedApps.length > 0) {
    score += 18;
    reasons.push({ id: "external_application_domain", points: 18, message: "The application link leads to a different domain.", source: "metadata" });
  }
  if ((page.emails || []).some((email) => FREE_EMAIL.has(email.split("@").pop()?.toLowerCase()))) {
    score += 13;
    reasons.push({ id: "free_email_contact", points: 13, message: "A public email service is used for recruitment contact.", source: "metadata" });
  }
  if ((page.contactCues || []).length > 0) {
    score += 12;
    reasons.push({ id: "messaging_contact", points: 12, message: "The page contains off-platform messaging contact cues.", source: "metadata" });
  }
  if (externalDomains.length >= 8) {
    score += 6;
    reasons.push({ id: "many_external_domains", points: 6, message: "The page links to many different external domains.", source: "metadata" });
  }
  if ((page.extractionQuality || 0) < 0.45) {
    score += 10;
    reasons.push({ id: "extraction_uncertainty", points: 10, message: "The page could not be extracted reliably.", source: "metadata" });
  }

  score = clamp(score);
  const metadataCount = [pageDomain, page.title, ...(page.links || [])].filter(Boolean).length;
  const coverage = clamp(metadataCount / 8, 0, 1);
  return { model: "metadata-only", score, tier: tierFor(score), confidence: confidenceFor(score, coverage), reasons: uniqueReasons(reasons) };
}

export function scoreMultiSignal(page) {
  const text = scoreTextOnly(page);
  const metadata = scoreMetadataOnly(page);
  const sharedSignals = text.reasons.length > 0 && metadata.reasons.length > 0 ? 8 : 0;
  const score = clamp(Math.round(text.score * 0.58 + metadata.score * 0.42 + sharedSignals));
  const reasons = uniqueReasons([...text.reasons, ...metadata.reasons]).sort((a, b) => b.points - a.points).slice(0, 5);
  return {
    model: "multi-signal",
    score,
    tier: tierFor(score),
    confidence: Math.round((text.confidence + metadata.confidence) / 2),
    reasons,
    components: { textScore: text.score, metadataScore: metadata.score }
  };
}

export function scoreAll(page) {
  return {
    textOnly: scoreTextOnly(page),
    metadataOnly: scoreMetadataOnly(page),
    multiSignal: scoreMultiSignal(page)
  };
}

export function combineBackend(localResult, backendResult) {
  const backendScore = Number(backendResult?.score || 0);
  const weightedScore = Math.round(localResult.score * 0.7 + backendScore * 0.3);
  const score = clamp(Math.max(localResult.score, weightedScore));
  return {
    model: "full-workflow",
    score,
    tier: tierFor(score),
    confidence: clamp(Math.round((localResult.confidence + Number(backendResult?.confidence || 50)) / 2)),
    reasons: uniqueReasons([...(localResult.reasons || []), ...(backendResult?.reasons || [])]).slice(0, 7),
    backend: backendResult
  };
}

export const scoringInternals = { domainOf, registrableApprox, tierFor };
