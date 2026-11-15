import { joinTestReferences } from "./test-cases.js";

export const RESEARCH_GATES = ["precisionJustified", "conformancePassed", "leakageAuditPassed", "overlapTaxonomySealed"];
export const OVERLAP_CATEGORIES = ["DIRECT", "RELATED", "LOWER-OVERLAP"];
export function defaultResearchContract() {
  return { analysisVersion: "rq1-single-annotator-v1", annotationMode: "single", annotatorId: null,
    annotationProtocolVersion: null, validationTieBreak: "textOnly", lowerOverlapMinGroups: null,
    lowerOverlapClassMinGroups: null, unresolvedCrossSplitPairs: null,
    sealedBeforeHeldOut: false, ...Object.fromEntries(RESEARCH_GATES.map(key => [key, false])), evidenceNotes: "" };
}

export function validateResearchContract(value) {
  if (!value || value.analysisVersion !== "rq1-single-annotator-v1" || value.annotationMode !== "single") throw new Error("Use the single-annotator RQ1 protocol.");
  for (const key of ["annotatorId", "annotationProtocolVersion"]) {
    if (value[key] != null && (typeof value[key] !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(value[key]))) throw new Error(`Invalid ${key}. Use 1–80 letters, numbers, dots, hyphens or underscores.`);
  }
  if (!["textOnly", "metadataOnly"].includes(value.validationTieBreak)) throw new Error("Select a validation tie-break branch.");
  for (const key of ["lowerOverlapMinGroups", "lowerOverlapClassMinGroups", "unresolvedCrossSplitPairs"]) {
    if (value[key] != null && (!Number.isSafeInteger(value[key]) || value[key] < (key === "unresolvedCrossSplitPairs" ? 0 : 1))) throw new Error(`Invalid ${key}.`);
  }
  for (const key of [...RESEARCH_GATES, "sealedBeforeHeldOut"]) if (typeof value[key] !== "boolean") throw new Error(`Invalid ${key}.`);
  if (typeof value.evidenceNotes !== "string" || value.evidenceNotes.length > 4000) throw new Error("Evidence notes must be at most 4,000 characters.");
  return value;
}

export function heldOutAccessTime(cases = [], records = [], previous = null) {
  const values = [previous, ...cases.filter(c => c.split === "test" && c.groundTruth).map(c => c.labelledAt),
    ...records.filter(r => r.split === "test").map(r => r.startedAt || r.createdAt)]
    .filter(value => typeof value === "string" && Number.isFinite(Date.parse(value)));
  return values.length ? values.reduce((a, b) => Date.parse(a) <= Date.parse(b) ? a : b) : null;
}

function sealContent(contract) {
  return JSON.stringify(Object.fromEntries(Object.entries(contract).filter(([key]) => key !== "sealDigest").sort(([a], [b]) => a.localeCompare(b))));
}
async function digest(contract) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sealContent(contract)))), b => b.toString(16).padStart(2, "0")).join("");
}

export async function sealResearchContract(draft, firstHeldOutAccessAt, now = new Date().toISOString()) {
  validateResearchContract(draft);
  if (firstHeldOutAccessAt) throw new Error("Held-out labels or scans have already been recorded. This protocol cannot be sealed retrospectively; use an unsealed exploratory export.");
  if (!draft.annotatorId || !draft.annotationProtocolVersion || !draft.lowerOverlapMinGroups || !draft.lowerOverlapClassMinGroups || draft.unresolvedCrossSplitPairs !== 0 || RESEARCH_GATES.some(key => draft[key] !== true) || !draft.evidenceNotes.trim()) {
    throw new Error("Complete the annotator/rubric IDs, justified support floors, zero unresolved pairs, evidence notes and documented checks before sealing. Do not invent completed evidence.");
  }
  const sealed = { ...draft, sealedBeforeHeldOut: true, sealedAt: now };
  sealed.sealDigest = await digest(sealed);
  return sealed;
}

export async function contractForExport(stored, firstHeldOutAccessAt) {
  const contract = { ...defaultResearchContract(), ...(stored || {}) };
  validateResearchContract(contract);
  const sealed = contract.sealedBeforeHeldOut === true && typeof contract.sealedAt === "string" && Number.isFinite(Date.parse(contract.sealedAt)) &&
    (!firstHeldOutAccessAt || Date.parse(contract.sealedAt) < Date.parse(firstHeldOutAccessAt)) && contract.sealDigest === await digest(contract);
  return { ...contract, sealedBeforeHeldOut: !!sealed };
}

export async function buildResearchExport(stored, now = new Date().toISOString()) {
  const testCases = stored.testCases || [], attempts = [...(stored.scanLogs || []), ...(stored.extractionFailures || [])];
  const firstHeldOutAccessAt = heldOutAccessTime(testCases, attempts, stored.rq1HeldOutAccessAt);
  const analysisContract = await contractForExport(stored.analysisContract, firstHeldOutAccessAt);
  const records = joinTestReferences(stored.scanLogs || [], testCases, attempts);
  const extractionFailures = joinTestReferences(stored.extractionFailures || [], testCases, attempts);
  const issues = [];
  if (!analysisContract.sealedBeforeHeldOut) issues.push("Protocol is an unsealed draft or its prospective seal could not be verified.");
  for (const key of ["annotatorId", "annotationProtocolVersion"]) if (!analysisContract[key]) issues.push(`Protocol missing ${key}.`);
  for (const gate of RESEARCH_GATES) if (!analysisContract[gate]) issues.push(`Protocol check not completed: ${gate}.`);
  for (const key of ["lowerOverlapMinGroups", "lowerOverlapClassMinGroups", "unresolvedCrossSplitPairs"]) if (analysisContract[key] == null) issues.push(`Protocol missing ${key}.`);
  const metadataIssues = {};
  for (const split of ["validation", "test"]) {
    if (!records.some(r => r.split === split && ["low", "uncertain", "elevated"].includes(r.groundTruth))) issues.push(`No reference-sufficient ${split} records are available.`);
  }
  for (const row of records.filter(r => ["validation", "test"].includes(r.split) && !r.evaluationOverride && !r.synthetic && r.timingPhase !== "warmup")) {
    const missing = [];
    if (!row.groupId) missing.push("groupId");
    if (!OVERLAP_CATEGORIES.includes(row.overlapCategory)) missing.push("overlapCategory");
    if (!row.annotatorId || row.annotatorId !== analysisContract.annotatorId) missing.push("annotatorId");
    if (!row.annotationProtocolVersion || row.annotationProtocolVersion !== analysisContract.annotationProtocolVersion) missing.push("annotationProtocolVersion");
    if (row.reference?.recordedBeforePrediction !== true) missing.push("prediction-blind reference");
    if (!["low", "uncertain", "elevated"].includes(row.groundTruth)) missing.push("reference-sufficient label");
    if (missing.length) metadataIssues[row.scenarioId || row.id] = missing;
  }
  return { schemaVersion: 1, exportedAt: now, analysisContract, records, extractionFailures, testCases,
    researchReadiness: { status: issues.length || Object.keys(metadataIssues).length ? "incomplete" : "metadata complete; run Python analysis for support and validity checks",
      firstHeldOutAccessAt, protocolIssues: issues, caseIssues: metadataIssues,
      note: "Metadata checks are not a research verdict. No missing labels, groups, evidence or successful outcomes are invented." } };
}
