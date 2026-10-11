import unittest

from extension.analysis.evaluate import evaluate


def record(truth, text, metadata, multi, full=None, condition="score-only", decision=None):
    return {
        "groundTruth": truth,
        "baselines": {
            "textOnly": {"score": text, "tier": "elevated" if text >= 60 else "uncertain" if text >= 30 else "low"},
            "metadataOnly": {"score": metadata, "tier": "elevated" if metadata >= 60 else "uncertain" if metadata >= 30 else "low"},
            "multiSignal": {"score": multi, "tier": "elevated" if multi >= 60 else "uncertain" if multi >= 30 else "low"},
        },
        "fullWorkflow": {"score": full, "tier": "elevated" if full >= 60 else "uncertain" if full >= 30 else "low"} if full is not None else None,
        "interfaceCondition": condition,
        "participantResponse": {"decision": decision, "decisionTimeMs": 1000, "actionability": 4} if decision else None,
        "localScoringLatencyMs": 1,
        "totalLatencyMs": 10,
        "escalation": {"attempted": full is not None, "status": "completed" if full is not None else "not-required", "backendLatencyMs": 2},
    }


class EvaluateTests(unittest.TestCase):
    def test_metrics_and_study(self):
        payload = {"records": [
            record("elevated", 70, 20, 80, 85, "explanation", "elevated"),
            record("low", 10, 10, 10, 10, "score-only", "low"),
        ]}
        result = evaluate(payload, 2)
        self.assertEqual(result["models"]["multi-signal"]["three_class_accuracy"], 1.0)
        self.assertEqual(result["models"]["multi-signal"]["precision_at_2"], 0.5)
        self.assertEqual(result["interface_study"]["explanation"]["agreement_with_ground_truth"], 1.0)


if __name__ == "__main__":
    unittest.main()
