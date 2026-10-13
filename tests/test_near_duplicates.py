import random
import unittest
from Baseline.near_duplicates import similarity_join,audit_texts,cross_split_audit,normalise_text


class NearDuplicateTests(unittest.TestCase):
    def test_prefix_join_matches_brute_force(self):
        rng=random.Random(42)
        for threshold in (.5,.8,1.0):
            sets=[set(rng.sample(range(25),rng.randrange(1,26))) for _ in range(80)]
            sets+=[sets[0].copy(),sets[1]|{100},set(),{999}]
            observed={(a,b) for a,b,*_ in similarity_join(sets,threshold)[0]}
            expected={(a,b) for a in range(len(sets)) for b in range(a+1,len(sets)) if sets[a]|sets[b] and len(sets[a]&sets[b])/len(sets[a]|sets[b])>=threshold}
            self.assertEqual(observed,expected)
    def test_threshold_boundary_and_transitive_groups(self):
        sets=[set(range(10)),set(range(8)),set(range(7))]
        pairs=similarity_join(sets,.8)[0]
        self.assertTrue(any(a==0 and b==1 for a,b,*_ in pairs))
        self.assertFalse(any(a==0 and b==2 for a,b,*_ in pairs))
        text=" ".join(f"token{i}" for i in range(40))
        result=audit_texts([text,text+" extra",text+" extra more","different words do not match this sentence"],[1,2,3,4])
        self.assertEqual(len(set(result["groups"][:3])),1)
        self.assertNotEqual(result["groups"][0],result["groups"][3])
    def test_leakage_fails_closed(self):
        text="a b c d e f g h i j k l m n o p"
        result=audit_texts([text,text+" q"],[1,2])
        self.assertFalse(cross_split_audit(result,["train","test"])["passed"])
        self.assertTrue(cross_split_audit(result,["train","train"])["passed"])
    def test_normalisation_and_exact_short_text(self):
        self.assertEqual(normalise_text("  ＨELLO\u00a0World! "),"hello world!")
        result=audit_texts(["short text","SHORT  TEXT"],[1,2])
        self.assertEqual(result["groups"][0],result["groups"][1])
        self.assertEqual(result["summary"]["short_text_without_five_token_shingles"],2)
    def test_duplicate_ids_rejected(self):
        with self.assertRaises(ValueError):audit_texts(["first","second"],[1,1])


if __name__=="__main__":unittest.main()
