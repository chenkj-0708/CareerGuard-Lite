import unittest
from analysis.rq2 import scan_statistics


def row(identifier, scenario, elapsed, **extra):
    return dict(id=identifier, scenarioId=scenario, totalLatencyMs=elapsed,
                startedAt=f'2026-11-05T00:00:{identifier.zfill(2)}.000Z', **extra)


class RQ2Tests(unittest.TestCase):
    def test_retries_cannot_rescue_first_failure_or_overweight_timing(self):
        success = [row('02','a',100), row('03','a',100), row('04','a',100), row('05','b',500)]
        failures = [row('01','b',800,failureCode='INJECTION_FAILED')]
        s = scan_statistics(success, failures)
        self.assertEqual(s['independent_scenarios'],2)
        self.assertEqual(s['scenario_success_rate'],.5)
        self.assertEqual((s['successful_attempts'],s['failed_attempts']),(4,1))
        self.assertEqual(s['repeated_attempts'],3)
        self.assertEqual(s['mixed_outcome_scenarios'],1)
        self.assertEqual(s['timing']['success']['median_ms'],300)
        self.assertEqual(s['timing']['success']['p95_ms'],480)
        self.assertEqual(s['timing']['failure']['median_ms'],800)

    def test_excluded_runs_duplicates_and_missing_timings(self):
        valid=row('01','a',None)
        s=scan_statistics([valid,valid,row('02','b',999,evaluationOverride=True),
                           row('03','c',999,timingPhase='warmup'),row('04',None,10)],[])
        self.assertEqual(s['excluded'],dict(forced=1,warmup=1,unidentified=1,duplicate_attempt=1))
        self.assertEqual(s['scan_attempts'],1)
        self.assertIsNone(s['timing']['all']['median_ms'])
        self.assertEqual(s['timing']['all']['missing_timing_runs'],1)
        self.assertIsNone(scan_statistics([],[])['scenario_success_rate'])

    def test_backend_timeout_latency_is_kept(self):
        s=scan_statistics([row('01','a',2100,escalation=dict(attempted=True,status='unavailable',error='TIMEOUT',clientLatencyMs=2000))],[])
        self.assertEqual(s['successful_scenarios'],1)
        self.assertEqual(s['timing']['backend']['median_ms'],2000)


if __name__ == '__main__':
    unittest.main()
