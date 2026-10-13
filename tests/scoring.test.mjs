import assert from "node:assert/strict";
import { combineBackend, scoreAll } from "../lib/scoring.js";

const safe = {
  url: "https://jobs.example.com/software-engineer", protocol: "https:", title: "Software Engineer",
  companyText: "Example Sdn Bhd", visibleText: "Software engineer position with detailed responsibilities, requirements, benefits, team information and a standard application process. ".repeat(8),
  links: ["https://jobs.example.com/apply"], externalLinks: [], applicationLinks: ["https://jobs.example.com/apply"], emails: ["jobs@example.com"], contactCues: [], extractionQuality: 1
};
const risky = {
  ...safe, url: "http://unknown.example/jobs", protocol: "http:",
  visibleText: "URGENT HIRING. Pay a registration fee. Contact us on WhatsApp. Guaranteed income. Send bank account details.",
  applicationLinks: ["https://bit.ly/apply-now"], externalLinks: ["https://bit.ly/apply-now"], emails: ["recruiter@gmail.com"], contactCues: ["whatsapp"], extractionQuality: .4
};

const safeScores = scoreAll(safe);
const riskyScores = scoreAll(risky);
assert.equal(safeScores.textOnly.tier, "low");
assert.ok(riskyScores.textOnly.score > safeScores.textOnly.score);
assert.ok(riskyScores.metadataOnly.score > safeScores.metadataOnly.score);
assert.ok(riskyScores.multiSignal.score >= 60);
const local = riskyScores.multiSignal;
const full = combineBackend(local, { schemaVersion: 2, score: 100, tier: "low", confidence: 0,
  checks: { contact_domain_match: { status: "contradicted" } } });
assert.equal(full.model, "full-workflow");
assert.equal(full.score, local.score);
assert.equal(full.tier, local.tier);
assert.equal(full.confidence, local.confidence);
assert.deepEqual(full.reasons, local.reasons);
assert.throws(() => combineBackend(local, { score: 0 }));
assert.throws(() => combineBackend(local, { schemaVersion: 2, checks: { x: { status: "safe" } } }));
assert.throws(() => scoreAll({ ...safe, extractionStatus: "unavailable" }));
console.log("scoring and authority tests passed");
