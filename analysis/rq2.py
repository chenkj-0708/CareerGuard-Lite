"""Scenario-level operational scan statistics, matching lib/scan-statistics.js."""
import math
from collections import Counter, defaultdict
from datetime import datetime


def percentile(values, p):
    if not values:
        return None
    values = sorted(values)
    position = (len(values) - 1) * p
    lo, hi = math.floor(position), math.ceil(position)
    return round(values[lo] + (values[hi] - values[lo]) * (position - lo), 3)


def timing(rows, getter):
    groups = defaultdict(list)
    missing = 0
    for row in rows:
        value = getter(row)
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            missing += 1
            continue
        groups[row['scenarioId']].append(value)
    medians = [percentile(values, .5) for values in groups.values()]
    return dict(scenarios=len(medians), measured_runs=len(rows)-missing, missing_timing_runs=missing,
                median_ms=percentile(medians, .5), p95_ms=percentile(medians, .95))


def timestamp(row):
    try:
        return datetime.fromisoformat((row.get('startedAt') or row.get('createdAt') or '').replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return 0


def scan_statistics(records, failures):
    excluded = dict(forced=0, warmup=0, unidentified=0, duplicate_attempt=0)
    seen, rows = set(), []
    for source, success in ((records, True), (failures, False)):
        for row in source:
            if row.get('evaluationOverride'):
                excluded['forced'] += 1
                continue
            if row.get('timingPhase') == 'warmup':
                excluded['warmup'] += 1
                continue
            if not row.get('scenarioId'):
                excluded['unidentified'] += 1
                continue
            attempt = row.get('attemptId') or row.get('id')
            if attempt and attempt in seen:
                excluded['duplicate_attempt'] += 1
                continue
            if attempt:
                seen.add(attempt)
            rows.append(dict(row, success=success))
    rows.sort(key=lambda r: (timestamp(r), str(r.get('attemptId') or r.get('id') or '')))
    groups = defaultdict(list)
    for row in rows:
        groups[row['scenarioId']].append(row)
    first = [values[0] for values in groups.values()]
    succeeded = sum(r['success'] for r in first)
    successes, failed = [r for r in rows if r['success']], [r for r in rows if not r['success']]
    return dict(
        independent_scenarios=len(first), successful_scenarios=succeeded, failed_scenarios=len(first)-succeeded,
        scenario_success_rate=succeeded/len(first) if first else None,
        scan_attempts=len(rows), successful_attempts=len(successes), failed_attempts=len(failed),
        repeated_attempts=len(rows)-len(first), mixed_outcome_scenarios=sum(any(r['success'] for r in values) and any(not r['success'] for r in values) for values in groups.values()),
        excluded=excluded, failure_codes=dict(Counter(r.get('failureCode') or 'LEGACY_FAILURE' for r in failed)),
        timing=dict(all=timing(rows, lambda r:r.get('totalLatencyMs')),
                    success=timing(successes, lambda r:r.get('totalLatencyMs')),
                    failure=timing(failed, lambda r:r.get('totalLatencyMs')),
                    extraction=timing(rows, lambda r:r.get('page', {}).get('extractionLatencyMs', r.get('extractionLatencyMs'))),
                    local=timing(successes, lambda r:r.get('localScoringLatencyMs')),
                    backend=timing([r for r in rows if r.get('escalation', {}).get('attempted')], lambda r:r.get('escalation', {}).get('clientLatencyMs'))),
        counting_rule='First measured attempt per scenario determines success; repeated timings are reduced to one median per scenario before median/p95. Forced runs and marked warm-ups excluded. Legacy scenario IDs are not reconstructed.')
