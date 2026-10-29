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
