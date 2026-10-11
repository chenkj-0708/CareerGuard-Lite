import unittest

from extension.backend.verifier import VerificationEngine


class VerifierTests(unittest.TestCase):
    def test_safe_case_stays_low(self):
        result = VerificationEngine().verify({
            "pageUrl": "https://jobs.example.com/role",
            "applicationLinks": ["https://jobs.example.com/apply"],
            "emails": ["careers@example.com"],
            "textExcerpt": "A normal software engineering vacancy.",
        })
        self.assertEqual(result["tier"], "low")

    def test_high_risk_case_is_elevated(self):
        result = VerificationEngine().verify({
            "pageUrl": "http://unknown.example/role",
            "applicationLinks": ["https://bit.ly/hidden"],
            "emails": ["recruiter@gmail.com"],
            "textExcerpt": "Pay a registration fee and send your bank account details.",
        })
        self.assertEqual(result["tier"], "elevated")
        self.assertGreaterEqual(len(result["reasons"]), 3)

    def test_duplicate_campaign_uses_fingerprint_only(self):
        engine = VerificationEngine()
        for domain in ("one.example", "two.example", "three.example"):
            result = engine.verify({"pageUrl": f"https://{domain}/job", "textExcerpt": "Identical suspicious campaign wording"})
        self.assertEqual(result["checks"]["duplicateSourceCount"], 3)
        self.assertTrue(any(item["id"] == "cross_domain_duplicate" for item in result["reasons"]))


if __name__ == "__main__":
    unittest.main()
