"""Privacy-bounded deterministic checks for selectively escalated listings."""

from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

SHORTENERS = {"bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "cutt.ly", "rb.gy"}
FREE_EMAIL = {"gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "proton.me", "protonmail.com"}
COMPOUND_SUFFIXES = {"com.my", "com.sg", "com.au", "co.uk", "co.nz", "co.jp"}


def domain_of(value: str) -> str:
    return (urlparse(value).hostname or "").lower().removeprefix("www.")


def root_domain(domain: str) -> str:
    parts = [part for part in domain.split(".") if part]
    if len(parts) <= 2:
        return domain
    tail = ".".join(parts[-2:])
    return ".".join(parts[-3:]) if tail in COMPOUND_SUFFIXES else tail


def reason(identifier: str, points: int, message: str) -> dict:
    return {"id": identifier, "points": points, "message": message, "source": "backend"}


@dataclass
class VerificationEngine:
    """In-memory verifier; stores fingerprints and source domains, never raw listing text."""

    fingerprint_sources: dict[str, set[str]] = field(default_factory=dict)

    def verify(self, payload: dict) -> dict:
        started = time.perf_counter()
        page_domain = domain_of(payload.get("pageUrl", "")) or payload.get("pageDomain", "")
        page_root = root_domain(page_domain)
        application_domains = [domain_of(value) for value in payload.get("applicationLinks", [])]
        application_domains = [value for value in application_domains if value]
        text = str(payload.get("textExcerpt", ""))[:5000]
        emails = [str(value).lower() for value in payload.get("emails", [])]
        reasons: list[dict] = []
        score = 5

        unrelated = sorted({value for value in application_domains if root_domain(value) != page_root})
        if unrelated:
            score += 22
            reasons.append(reason("backend_domain_mismatch", 22, "Backend verification found an application-domain mismatch."))
        if any(value in SHORTENERS for value in application_domains):
            score += 25
            reasons.append(reason("backend_shortened_link", 25, "A shortened application link hides the final destination."))
        if any(email.rsplit("@", 1)[-1] in FREE_EMAIL for email in emails if "@" in email):
            score += 12
            reasons.append(reason("backend_free_email", 12, "Recruitment contact uses a public email provider."))
        if re.search(r"\b(payment|deposit|fee|gift card|cryptocurrency|bank account|otp)\b", text, re.I):
            score += 25
            reasons.append(reason("backend_high_risk_request", 25, "Deeper text checks found a payment or sensitive-information request."))

        normalized = re.sub(r"\W+", " ", text.lower()).strip()
        fingerprint = hashlib.sha256(normalized.encode("utf-8")).hexdigest() if normalized else ""
        if fingerprint:
            sources = self.fingerprint_sources.setdefault(fingerprint, set())
            sources.add(page_root)
            if len(sources) >= 3:
                score += 18
                reasons.append(reason("cross_domain_duplicate", 18, "The same listing text was observed across several unrelated domains."))

        score = min(100, score)
        tier = "elevated" if score >= 60 else "uncertain" if score >= 30 else "low"
        confidence = min(95, 55 + len(reasons) * 10)
        return {
            "schemaVersion": 1,
            "score": score,
            "tier": tier,
            "confidence": confidence,
            "reasons": reasons,
            "checks": {
                "applicationDomains": application_domains,
                "unrelatedApplicationDomains": unrelated,
                "duplicateSourceCount": len(self.fingerprint_sources.get(fingerprint, set())) if fingerprint else 0,
            },
            "dataRetention": "Only a SHA-256 text fingerprint and source domain are retained in memory.",
            "latencyMs": round((time.perf_counter() - started) * 1000, 2),
        }
