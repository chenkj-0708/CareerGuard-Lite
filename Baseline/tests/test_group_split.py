import unittest
import pandas as pd
from Baseline.careerguard_block1_baseline import split_data,build_models,select_f1_threshold
import numpy as np


class GroupSplitTests(unittest.TestCase):
    def test_group_integrity_and_reproducibility(self):
        data=pd.DataFrame({"job_id":range(80),"fraudulent":[(i//2)%2 for i in range(80)],"duplicate_group_id":[f"g{i//2}" for i in range(80)]})
        first=split_data(data,42);second=split_data(data,42)
        self.assertEqual(sum(len(frame) for frame in first),80)
        for a,b in zip(first,second):self.assertEqual(a.job_id.tolist(),b.job_id.tolist())
        for i in range(3):
            for j in range(i+1,3):self.assertFalse(set(first[i].duplicate_group_id)&set(first[j].duplicate_group_id))
    def test_no_ungrouped_fallback(self):
        with self.assertRaises(ValueError):split_data(pd.DataFrame({"fraudulent":[0,1]}),42)
    def test_fixed_model_family(self):
        for model in build_models(42,100).values():
            classifier=model.named_steps["classifier"]
            self.assertEqual(classifier.class_weight,"balanced")
            self.assertEqual(classifier.max_iter,1000)
            self.assertEqual(classifier.solver,"liblinear")
    def test_threshold_uses_validation_values(self):
        threshold,score=select_f1_threshold(np.array([0,0,1,1]),np.array([.1,.2,.7,.9]))
        self.assertEqual(threshold,.7);self.assertEqual(score,1)


if __name__=="__main__":unittest.main()
