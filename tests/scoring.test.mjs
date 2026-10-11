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
const full = combineBackend(riskyScores.multiSignal, { score: 90, confidence: 90, reasons: [{ id: "backend", points: 20, message: "Backend evidence", source: "backend" }] });
assert.equal(full.model, "full-workflow");
assert.ok(full.score >= riskyScores.multiSignal.score);
console.log("scoring tests passed");
