# Q12 EMSCAD Near-Duplicate Audit and Baseline Rerun

Completed for Supervisor Guideline Q12, 2026-10-13 (Asia/Kuala_Lumpur). The scope is historical EMSCAD split leakage, not browser RQ1 or live recruitment-risk validation.

## Result

The eligible dataset contains **17,554 postings** grouped into **13,060 operational text-similarity groups**. The declared 5-token-shingle Jaccard >=0.80 detector found **111,385 qualifying pairs**, including identical-token pairs. All threshold candidates were conservatively co-grouped; manual duplicate confirmation is not claimed.

The reconstructed legacy row split had **24,845 train-test qualifying pairs**, **50,336 qualifying pairs across any partitions**, and **840 groups spanning partitions. The original historical split-ID file was not retained, so these are reconstruction findings, not an assertion of exact archived membership.

The new allocation passes the independently recomputed gate: **0 train-test near-duplicate pairs, 0 cross-partition near-duplicate pairs, 0 exact-text duplicate edges crossing partitions and 0 shared duplicate groups**. This guarantee is limited to the declared representation/normalisation/threshold, not all paraphrases or semantic duplicates.

## Grouped support

| Split | Postings | Fraudulent labels | Groups |
| --- | ---: | ---: | ---: |
| train | 12,292 | 601 | 9,105 |
| validation | 2,631 | 127 | 1,978 |
| test | 2,631 | 128 | 1,977 |

20 stratified group folds with seed 42 use 14 folds for train, three for validation and three for test. No group can be divided to achieve a more convenient row ratio. Exact feature duplicates were removed under the existing cleaning policy before this text-group audit.

There are 1,450 multi-posting groups, a largest group of 411 postings, 539 exact-normalised-text groups (1,682 additional postings), and 2 mixed-label groups. Mixed labels were retained and all members remain in one partition. Template/company boilerplate may conservatively enlarge groups; the algorithm does not prove campaign identity.

## Completed baseline results

| Model | Precision | Recall | F1 | Macro F1 | PR-AUC | Selected C |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Text-only baseline | 0.8776 | 0.6719 | 0.7611 | 0.8752 | 0.8322 | 10 |
| Structured-only baseline | 0.3615 | 0.7344 | 0.4845 | 0.7218 | 0.5236 | 1 |
| Combined text + structured | 0.7519 | 0.7578 | 0.7549 | 0.8711 | 0.8486 | 10 |

All three models use the identical 2,631 held-out posting IDs. Saved predictions were independently checked against memberships, selected thresholds and recalculated F1. Confusion matrices, false-positive/negative rates, case IDs, PR/ROC AUC, Brier/log loss, selected thresholds and runtime measurements are retained alongside this report.

The C grid {0.1,1,10} was selected only by validation AUPRC, followed by validation F1 threshold selection. Test outcomes did not choose similarity thresholds, C or decision thresholds. The old fixed-C/highest-threshold protocol and dependency versions also changed to the thesis-aligned selection rules/current recorded environment; new-minus-old metric differences are not a paired causal estimate of duplicate-control benefit. Prior results/models were preserved. The data had previously supported prototype experiments, so no claim of a newly untouched external dataset is made.

## Verification and files

- Five detector tests include exact comparison with brute-force joins, threshold edges, transitive grouping, Unicode normalization and fail-closed leakage checks.
- Four grouped-split/model-protocol tests verify repeatable allocation, group isolation, no ungrouped fallback and validation threshold behavior.
- Two full-corpus similarity passes were executed, before and after allocation. The gate prohibits fitting if the post-split audit fails.
- `near_duplicate_pairs.csv` records all candidate IDs/Jaccard values and `UNREVIEWED_CONSERVATIVE_SAME_GROUP` status.
- `duplicate_group_membership.csv`, `duplicate_group_summary.csv`, `legacy_cross_split_near_duplicates.csv` and `grouped_cross_split_near_duplicates.csv` permit inspection; the grouped cross-split file contains only its header.
- `block1_model_results.csv`, `block1_test_predictions.csv`, `block1_confusion_matrices.csv`, `false_positive_false_negative_cases.csv` and model `.config.json` files contain the rerun evidence.
- `leakage_audit.json` and `block1_run_config.json` record normalization, threshold, split, dataset/code hashes, parameters and runtime versions.

## Reproduce

From CareerGuard-Lite:

```powershell
Baseline/.venv/Scripts/python.exe Baseline/careerguard_block1_baseline.py --results-dir Baseline/block1_results_near_duplicate_v2 --models-dir Baseline/block1_models_near_duplicate_v2
```

Use `requirements-near-duplicate-lock.txt` to recreate the exact installed environment. The legacy Colab notebook is explicitly marked nonconformant rather than silently reused.

Dataset SHA-256: `59253295129d8b6a27607f9904f7d4ddf4dbb0ee35e079c7eb51b58b5e62bf60`.
Detector SHA-256: `fdd5b80221457b47f431ed61e033d2501a5b57093ba865b71e261c633291b71c`.
Runner SHA-256: `7bb9e469b809fe9226caaec0aac09f341935be5f1dded87a2c7d29a87a5e8260`.
