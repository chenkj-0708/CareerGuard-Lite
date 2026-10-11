"""Calculate CareerGuard browser-baseline and explanation-study metrics.

Input is the JSON export produced by the extension evaluation dashboard.
Only records with a ground-truth label are used for model metrics.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path

GRADE = {"low": 0, "uncertain": 1, "elevated": 2}
MODEL_PATHS = {
    "text-only": ("baselines", "textOnly"),
    "metadata-only": ("baselines", "metadataOnly"),
    "multi-signal": ("baselines", "multiSignal"),
    "full-workflow": ("fullWorkflow",),
}


def nested(record: dict, path: tuple[str, ...]):
    value = record
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def safe_mean(values: list[float]):
    return round(statistics.mean(values), 3) if values else None


def model_metrics(records: list[dict], path: tuple[str, ...], k: int) -> dict:
    rows = [(record, nested(record, path)) for record in records if record.get("groundTruth") in GRADE]
    rows = [(record, result) for record, result in rows if isinstance(result, dict)]
    if not rows:
        return {"labelled_records": 0}

    exact = sum(result.get("tier") == record["groundTruth"] for record, result in rows)
    tp = sum(result.get("tier") == "elevated" and record["groundTruth"] == "elevated" for record, result in rows)
    fp = sum(result.get("tier") == "elevated" and record["groundTruth"] != "elevated" for record, result in rows)
    fn = sum(result.get("tier") != "elevated" and record["groundTruth"] == "elevated" for record, result in rows)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    ranked = sorted(rows, key=lambda item: float(item[1].get("score", 0)), reverse=True)
    top = ranked[: min(k, len(ranked))]
    relevant_total = sum(record["groundTruth"] == "elevated" for record, _ in ranked)
    relevant_top = sum(record["groundTruth"] == "elevated" for record, _ in top)
    precision_at_k = relevant_top / len(top) if top else 0.0
    recall_at_k = relevant_top / relevant_total if relevant_total else 0.0

    gains = [GRADE[record["groundTruth"]] for record, _ in top]
    ideal = sorted((GRADE[record["groundTruth"]] for record, _ in ranked), reverse=True)[: len(top)]
    dcg = sum((2**gain - 1) / math.log2(index + 2) for index, gain in enumerate(gains))
    idcg = sum((2**gain - 1) / math.log2(index + 2) for index, gain in enumerate(ideal))

    return {
        "labelled_records": len(rows),
        "three_class_accuracy": round(exact / len(rows), 4),
        "elevated_precision": round(precision, 4),
        "elevated_recall": round(recall, 4),
        "elevated_f1": round(f1, 4),
        f"precision_at_{k}": round(precision_at_k, 4),
        f"recall_at_{k}": round(recall_at_k, 4),
        f"ndcg_at_{k}": round(dcg / idcg, 4) if idcg else 0.0,
    }


def study_metrics(records: list[dict]) -> dict:
    output = {}
    for condition in ("score-only", "explanation"):
        rows = [record for record in records if record.get("interfaceCondition") == condition and record.get("participantResponse")]
        decisions = [record for record in rows if record.get("groundTruth") in GRADE and record["participantResponse"].get("decision")]
        agreement = sum(record["participantResponse"]["decision"] == record["groundTruth"] for record in decisions)
        output[condition] = {
            "responses": len(rows),
            "agreement_with_ground_truth": round(agreement / len(decisions), 4) if decisions else None,
            "mean_decision_time_ms": safe_mean([float(record["participantResponse"]["decisionTimeMs"]) for record in rows if record["participantResponse"].get("decisionTimeMs") is not None]),
            "mean_actionability": safe_mean([float(record["participantResponse"]["actionability"]) for record in rows if record["participantResponse"].get("actionability") is not None]),
        }
    return output


def evaluate(payload: dict, k: int) -> dict:
    records = payload.get("records", [])
    attempts = [record for record in records if record.get("escalation", {}).get("attempted")]
    completed = [record for record in attempts if record.get("escalation", {}).get("status") == "completed"]
    return {
        "record_count": len(records),
        "models": {name: model_metrics(records, path, k) for name, path in MODEL_PATHS.items()},
        "latency": {
            "mean_local_scoring_ms": safe_mean([float(record["localScoringLatencyMs"]) for record in records if record.get("localScoringLatencyMs") is not None]),
            "mean_total_scan_ms": safe_mean([float(record["totalLatencyMs"]) for record in records if record.get("totalLatencyMs") is not None]),
            "mean_backend_ms": safe_mean([float(record["escalation"]["backendLatencyMs"]) for record in completed if record["escalation"].get("backendLatencyMs") is not None]),
        },
        "escalation": {
            "attempted": len(attempts),
            "completed": len(completed),
            "attempt_rate": round(len(attempts) / len(records), 4) if records else 0.0,
        },
        "interface_study": study_metrics(records),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="JSON export from the extension dashboard")
    parser.add_argument("--k", type=int, default=10)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = evaluate(json.loads(args.input.read_text(encoding="utf-8")), args.k)
    rendered = json.dumps(result, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
