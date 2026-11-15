import { CONFIG_ID } from "./risk-rules.js";

const TIERS = new Set(["low", "uncertain", "elevated"]);
export const METRIC_EXCLUSIONS = {
  first_attempt_failed: "First scan failed", reference_insufficient: "Insufficient reference information",
  unlabelled: "Missing or invalid label", reference_not_blind: "No evidence of labelling before prediction",
  configuration: "Legacy or unknown scoring configuration", extraction: "Extraction unavailable",
  predictions: "Incomplete paired predictions"
};

// Select the first retained measured attempt BEFORE checking reference eligibility.
// A later retry must not rescue an unsuitable first attempt or inflate the denominator.
export function dashboardMetrics(records = [], failures = []) {
  const first = new Map(), skipped = { forced: 0, warmup: 0, unidentified: 0, invalid_time: 0, repeats: 0 };
  const attempts = [];
  for (const [source, success] of [[records, true], [failures, false]]) {
    for (const record of source) {
      if (record.evaluationOverride || record.synthetic) { skipped.forced++; continue; }
      if (record.timingPhase === "warmup") { skipped.warmup++; continue; }
      if (!record.scenarioId) { skipped.unidentified++; continue; }
      const time = Date.parse(record.startedAt || record.createdAt);
      if (!Number.isFinite(time)) { skipped.invalid_time++; continue; }
      attempts.push({ record, success, time });
    }
  }
  attempts.sort((a, b) => a.time - b.time || String(a.record.attemptId || a.record.id || "").localeCompare(String(b.record.attemptId || b.record.id || "")));
  for (const attempt of attempts) {
    if (first.has(attempt.record.scenarioId)) { skipped.repeats++; continue; }
    first.set(attempt.record.scenarioId, attempt);
  }
  const excluded = {}, included = [];
  for (const { record: r, success } of first.values()) {
    let reason;
    if (!success) reason = "first_attempt_failed";
    else if (r.groundTruth === "reference-insufficient") reason = "reference_insufficient";
    else if (!TIERS.has(r.groundTruth)) reason = "unlabelled";
    else if (r.reference?.recordedBeforePrediction !== true) reason = "reference_not_blind";
    else if (r.configId !== CONFIG_ID) reason = "configuration";
    else if (["unsupported", "extraction-limited"].includes(r.page?.pageStatus) || r.page?.extractionStatus === "unavailable") reason = "extraction";
    else if (!["textOnly", "metadataOnly", "multiSignal"].every(key => TIERS.has(r.baselines?.[key]?.tier))) reason = "predictions";
    if (reason) excluded[reason] = (excluded[reason] || 0) + 1;
    else included.push(r);
  }
  return {
    cases: first.size, included_cases: included.length, excluded_cases: first.size - included.length,
    excluded, skipped,
    models: Object.fromEntries(["textOnly", "metadataOnly", "multiSignal"].map(key => [key, {
      count: included.length,
      agreement: included.length ? included.filter(r => r.baselines[key].tier === r.groundTruth).length / included.length : null
    }]))
  };
}
