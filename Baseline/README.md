# EMSCAD baselines with near-duplicate leakage control

`careerguard_block1_baseline.py` is the canonical runner. It audits similarities before fitting anything, groups exact/near-duplicate postings and uses one fixed group-preserving train/validation/test allocation shared by text-only, structured-only and combined logistic-regression pipelines. EMSCAD structured fields are historical posting attributes, not browser metadata.

## Run from CareerGuard-Lite

```powershell
python -m venv Baseline/.venv
Baseline/.venv/Scripts/python.exe -m pip install -r Baseline/requirements-near-duplicate-lock.txt
Baseline/.venv/Scripts/python.exe Baseline/careerguard_block1_baseline.py
```

The dataset defaults to `Baseline/data/fake_job_postings.csv`. New results/models default to `block1_results_near_duplicate_v1` and `block1_models_near_duplicate_v1`; old artifacts remain intact. Use new `--results-dir` and `--models-dir` paths for a separately versioned rerun. `--audit-only` stops before fitting. The legacy Colab notebook does not implement these controls and is not a Q12-conformant runner.

## Detection and split contract

The five cleaned narrative fields, with explicit section markers, are normalised using NFKC, lowercase, Unicode-whitespace collapse and trimming. Exact normalised-text SHA-256 matches are grouped. Alphanumeric tokens generate sets of contiguous five-token shingles. Every pair with exact set Jaccard >=0.80 is linked, including identical-token pairs. Rare-first length/prefix filtering is lossless for this threshold and is tested against brute-force all-pairs results; no approximate LSH, top-K or sampling can silently miss a qualifying pair.

Connected components are allocated as complete groups. All threshold candidates are conservatively co-grouped and marked `UNREVIEWED_CONSERVATIVE_SAME_GROUP`; the audit does not pretend a person confirmed each pair. Boilerplate may cause conservative over-grouping, and transitive endpoints need not themselves have Jaccard >=0.80. Labels never choose similarity thresholds or duplicate groups. Mixed-label groups retain their labels and cannot cross partitions.

A fixed seed 42 and 20 StratifiedGroupKFold folds allocate 14 folds to train, three to validation and three to test. Group integrity overrides exact row percentages. The detector is independently recomputed after allocation. Any exact/near/group crossing between any partitions fails the gate and prohibits model fitting. “Zero leakage” means zero crossings under this declared representation, normalisation and threshold; it is not a guarantee against all semantic/paraphrase duplicates.

Historical split-ID files were not available. The `legacy_*` audit reconstructs the old row-level split on the current eligible data/runtime and does not claim exact historical archived membership. Old metrics and new metrics use different test memberships, so their difference is not a paired estimate of the causal effect of duplicate control.

## Baseline protocol

All feature fitting is train-only. Each branch selects C from {0.1,1,10} by validation AUPRC (exact ties prefer smaller C), then selects its decision threshold by validation F1 (exact ties prefer closest to 0.5, then smaller threshold). The held-out test is scored after selection; no test result chooses C, weights, thresholds or the Jaccard gate. This also aligns the previously fixed-C/highest-threshold code with the thesis selection rules, so comparisons with old metrics reflect both split and protocol/environment changes.

Outputs include precision, recall, F1, macro F1, confusion matrices, FP/FN rates, PR/ROC AUC, Brier/log loss, predictions and timing. Existing offline ranking diagnostics are retained as supplementary historical outputs and are not browser RQ1 metrics.

## Audit evidence

- `leakage_audit.json`: data/detector hashes, group statistics, old-reconstruction and post-split gates.
- `near_duplicate_pairs.csv`: posting IDs, exact Jaccard/overlap/union, review status, old/new splits.
- `duplicate_group_membership.csv`: every eligible posting, SHA-256, group and split.
- `duplicate_group_summary.csv`: group sizes and label composition.
- `legacy_cross_split_near_duplicates.csv` and `grouped_cross_split_near_duplicates.csv`: cross-partition pair lists; the grouped file must be empty apart from its header.
- `block1_model_results.csv`, predictions, classification reports, confusion matrices and run configuration: completed three-model rerun.
- Model `.config.json` files: selected C and threshold alongside each fitted pipeline.

`Q12_REPORT.md` is generated from the completed audit/run and records actual support/results plus limitations. These are supplementary historical-data results, not proof of live-browser safety or real-world recruitment-fraud performance.

## Tests

```powershell
python -m unittest tests.test_near_duplicates -v
Baseline/.venv/Scripts/python.exe -m unittest discover -s Baseline/tests -v
```
