import assert from "node:assert/strict";
import { dashboardMetrics } from "../lib/dashboard-metrics.js";
import { CONFIG_ID, LEGACY_CONFIG_ID } from "../lib/risk-rules.js";

const row = (id, overrides = {}) => ({
  id, scenarioId: id, createdAt: "2026-11-13T00:00:01Z", configId: CONFIG_ID,
  groundTruth: "low", reference: { recordedBeforePrediction: true },
  page: { pageStatus: "scoreable", extractionStatus: "reliable" },
  baselines: Object.fromEntries(["textOnly", "metadataOnly", "multiSignal"].map(key => [key, { score: 5, tier: "low" }])),
  ...overrides
});
const first = row("one");
first.baselines.textOnly = { score: 70, tier: "elevated" };
const records = [row("one", { id: "retry", createdAt: "2026-11-13T00:00:02Z" }), first,
  row("insufficient", { groundTruth: "reference-insufficient" }), row("unlabelled", { groundTruth: null }),
  row("late", { reference: { recordedBeforePrediction: false } }), row("no-reference", { reference: null }),
  row("old", { configId: "old" }), row("failed", { createdAt: "2026-11-13T00:00:02Z" }),
  row("partial", { baselines: { multiSignal: { tier: "low" } } }),
  row("forced", { evaluationOverride: true }), row("warmup", { timingPhase: "warmup" }),
  row("no-id", { scenarioId: null }), row("bad-time", { createdAt: null }),
  row("unsupported", { page: { pageStatus: "unsupported" } })];
const metrics = dashboardMetrics(records, [{ scenarioId: "failed", id: "failed-first", createdAt: "2026-11-13T00:00:00Z" }]);
assert.equal(metrics.included_cases, 1);
assert.equal(metrics.excluded_cases, 8);
assert.equal(metrics.models.textOnly.agreement, 0);
assert.equal(metrics.models.metadataOnly.agreement, 1);
assert.equal(metrics.models.multiSignal.agreement, 1);
assert.equal(metrics.excluded.first_attempt_failed, 1);
assert.equal(metrics.excluded.reference_insufficient, 1);
assert.equal(metrics.excluded.reference_not_blind, 2);
assert.equal(metrics.skipped.repeats, 2);
assert.deepEqual([metrics.skipped.forced, metrics.skipped.warmup, metrics.skipped.unidentified, metrics.skipped.invalid_time], [1, 1, 1, 1]);
assert.equal(dashboardMetrics([]).models.multiSignal.agreement, null);
assert.equal(dashboardMetrics([row("rerun", { configId: LEGACY_CONFIG_ID }), row("rerun", {
  createdAt: "2026-11-13T00:00:02Z"
})]).included_cases, 1);
assert.deepEqual(dashboardMetrics([...records].reverse(), [{ scenarioId: "failed", id: "failed-first", createdAt: "2026-11-13T00:00:00Z" }]), metrics);
console.log("case-level reference agreement, shared denominator, exclusions and retry ordering passed");
