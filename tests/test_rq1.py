import copy
import unittest
from analysis.rq1 import evaluate_rq1,maoe,kappa,compare


def row(identifier,group,split,truth,text,meta,fused,overlap="LOWER-OVERLAP"):
    def result(tier):return {"tier":tier,"score":{"low":5,"uncertain":45,"elevated":80}[tier]}
    return {"id":identifier,"scenarioId":identifier,"groupId":group,"split":split,"overlapCategory":overlap,"configId":"thesis-primary-50-50-v1","groundTruth":truth,"annotatorLabels":[truth,truth],"page":{"pageStatus":"scoreable"},"baselines":{"textOnly":result(text),"metadataOnly":result(meta),"multiSignal":result(fused),"sensitivities":{key:result(fused) for key in ("priorWeight","rawScaling","lowerBoundaries","upperBoundaries")}}}


def corpus():
    rows=[]
    for i in range(15):
        truth=("low","uncertain","elevated")[i%3]
        wrong="elevated" if truth=="low" else "low"
        rows.append(row(f"v{i}",f"vg{i}","validation",truth,wrong,truth,truth))
        rows.append(row(f"t{i}",f"tg{i}","test",truth,truth,wrong,"uncertain"))
    return rows


class RQ1Tests(unittest.TestCase):
    def test_warmup_cannot_conflict_with_measured_reference(self):
        rows = corpus()
        warmup = copy.deepcopy(rows[0])
        warmup.update(timingPhase="warmup", groundTruth="elevated")
        result = evaluate_rq1([warmup] + rows, {"validationTieBreak":"textOnly"}, resamples=0)
        self.assertEqual(result["exclusions"]["warmup"], 1)
        self.assertNotIn("conflicting_repeat_predictions_or_labels", result["problems"])

    def single_study(self):
        rows = corpus()
        for r in rows:
            r.pop("annotatorLabels")
            r.update(annotatorId="researcher-1", annotationProtocolVersion="single-rubric-v1",
                     reference={"recordedBeforePrediction": True})
        contract = {"analysisVersion":"rq1-single-annotator-v1", "annotationMode":"single",
                    "annotatorId":"researcher-1", "annotationProtocolVersion":"single-rubric-v1",
                    "validationTieBreak":"textOnly", "lowerOverlapMinGroups":5,
                    "lowerOverlapClassMinGroups":5, "sealedBeforeHeldOut":True,
                    "precisionJustified":True, "conformancePassed":True, "leakageAuditPassed":True,
                    "overlapTaxonomySealed":True, "unresolvedCrossSplitPairs":0}
        return rows, contract

    def test_single_reference_can_report_exploratory_improvement_without_second_label(self):
        rows, contract = self.single_study()
        result = evaluate_rq1(rows, contract, resamples=30)
        self.assertEqual(result["status"], "Exploratory Improvement")
        self.assertEqual(result["missing_gates"], [])
        self.assertEqual(result["reference_agreement"]["status"], "not_applicable")
        self.assertIsNone(result["reference_agreement"]["linear_weighted_kappa"])
        self.assertIn("single-researcher", result["claim_scope"])
        self.assertTrue(result["limitations"])

    def test_single_reference_checks_every_record(self):
        for field, value in (("annotatorId", None), ("annotatorId", "another-person"),
                             ("annotationProtocolVersion", None), ("reference", None),
                             ("reference", {"recordedBeforePrediction":False})):
            with self.subTest(field=field, value=value):
                rows, contract = self.single_study()
                rows[-1][field] = value
                result = evaluate_rq1(rows, contract, resamples=0)
                self.assertEqual(result["status"], "Inconclusive")
                self.assertTrue(result["missing_gates"])

    def test_single_mode_does_not_bypass_sealing_or_version(self):
        rows, contract = self.single_study()
        contract["sealedBeforeHeldOut"] = False
        result = evaluate_rq1(rows, contract, resamples=0)
        self.assertEqual(result["status"], "Inconclusive")
        self.assertIn("sealedBeforeHeldOut", result["missing_gates"])
        contract["analysisVersion"] = "rq1-thesis-v1"
        self.assertIn("single_annotator_analysis_version", evaluate_rq1(rows, contract, resamples=0)["problems"])

    def test_single_no_improvement_is_reported_honestly(self):
        rows, contract = self.single_study()
        for r in rows:
            if r["split"] == "test":
                r["baselines"]["multiSignal"] = copy.deepcopy(r["baselines"]["metadataOnly"])
        self.assertEqual(evaluate_rq1(rows, contract, resamples=0)["status"], "No Exploratory Improvement")

    def test_repeat_cannot_hide_conflicting_annotation_provenance(self):
        rows, contract = self.single_study()
        repeat = copy.deepcopy(rows[0])
        repeat["reference"]["recordedBeforePrediction"] = False
        rows.append(repeat)
        self.assertIn("conflicting_repeat_predictions_or_labels", evaluate_rq1(rows, contract, resamples=0)["problems"])

    def test_dual_subset_agreement_cannot_pass_complete_reference_gate(self):
        rows, contract = self.single_study()
        contract.update(annotationMode="dual", analysisVersion="rq1-thesis-v1")
        for r in rows[:3]:
            r["annotatorLabels"] = [r["groundTruth"], r["groundTruth"]]
        result = evaluate_rq1(rows, contract, resamples=0)
        self.assertEqual(result["reference_agreement"]["linear_weighted_kappa"], 1)
        self.assertEqual(result["status"], "Inconclusive")
        self.assertIn("complete_dual_annotations", result["missing_gates"])

    def test_equal_group_weight(self):
        rows=[row(str(i),"large","test","elevated","low","low","low") for i in range(50)]+[row("one","small","test","low","low","low","low")]
        self.assertEqual(maoe(rows,"textOnly"),1)
    def test_validation_selection_and_lower_overlap(self):
        result=evaluate_rq1(corpus(),{"validationTieBreak":"textOnly"},resamples=30)
        self.assertEqual(result["selected_single_branch"],"metadataOnly")
        self.assertGreater(result["primary"]["delta_maoe"],0)
        self.assertEqual(result["lower_overlap"]["groups"],15)
        self.assertEqual(result["status"],"Inconclusive")
        self.assertIn("precisionJustified",result["missing_gates"])
    def test_integrity_rejects_leakage(self):
        rows=corpus();rows[1]["groupId"]=rows[0]["groupId"]
        result=evaluate_rq1(rows,resamples=0)
        self.assertIn("cross_split_group_leakage",result["problems"])
    def test_conflicting_repeats_rejected(self):
        rows=corpus();duplicate=copy.deepcopy(rows[0]);duplicate["groundTruth"]="elevated";rows.append(duplicate)
        self.assertIn("conflicting_repeat_predictions_or_labels",evaluate_rq1(rows,resamples=0)["problems"])
    def test_bootstrap_deterministic(self):
        rows=[r for r in corpus() if r["split"]=="test"]
        self.assertEqual(compare(rows,"metadataOnly",resamples=50),compare(rows,"metadataOnly",resamples=50))
    def test_lower_overlap_contradiction_caps_verdict(self):
        rows=corpus()
        for r in rows:
            if r["split"]=="test":
                r["baselines"]["sensitivities"]["rawScaling"]["tier"]="elevated" if r["groundTruth"]=="low" else "low"
                if r["groundTruth"]=="low": r["baselines"]["metadataOnly"]["tier"]="low"
        result=evaluate_rq1(rows,{"validationTieBreak":"textOnly"},resamples=10)
        self.assertEqual(result["status"],"Inconclusive")
        self.assertIn("metric_or_configuration_direction_reversal",result["missing_gates"])
    def test_no_group_inference_from_platform(self):
        rows=corpus();rows[0].pop("groupId")
        self.assertEqual(evaluate_rq1(rows,resamples=0)["exclusions"]["missing_group_split_or_overlap"],1)
    def test_sealed_gates_required_for_supported(self):
        rows=corpus()
        for r in rows:r["annotationProtocolVersion"]="independent-reference-v1"
        contract={"validationTieBreak":"textOnly","lowerOverlapMinGroups":5,"lowerOverlapClassMinGroups":5,"sealedBeforeHeldOut":True,"precisionJustified":True,"conformancePassed":True,"leakageAuditPassed":True,"overlapTaxonomySealed":True,"annotationProtocolVersion":"independent-reference-v1","unresolvedCrossSplitPairs":0}
        result=evaluate_rq1(rows,contract,resamples=30)
        self.assertEqual(result["status"],"Supported")
        contract["unresolvedCrossSplitPairs"]=1
        self.assertEqual(evaluate_rq1(rows,contract,resamples=0)["status"],"Inconclusive")
    def test_kappa_known_values(self):
        self.assertEqual(kappa([(0,0),(1,1),(2,2)]),1)
        self.assertLess(kappa([(0,2),(1,1),(2,0)]),0)


if __name__=="__main__":unittest.main()
