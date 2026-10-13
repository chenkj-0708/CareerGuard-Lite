# CareerGuard Lite Block 1 baseline comparison

`careerguard_block1_baseline.py` is the canonical, locally verified experiment runner. `CareerGuard_Block1_Colab.ipynb` is the interactive Colab companion.

The comparison uses one fixed, stratified EMSCAD train/validation/test split for three logistic-regression pipelines:

1. text-only (`title`, `company_profile`, `description`, `requirements`, `benefits`);
2. structured-only (the categorical and binary fields available in EMSCAD); and
3. combined text plus structured features.

The structured-only model is deliberately not called a browser-metadata model. EMSCAD has no live URL, domain-age, redirection, link-target, DOM, or rendering signals.

## Reproduce the experiment

From the repository root:

```powershell
python -m pip install -r baseline/requirements.txt
python baseline/careerguard_block1_baseline.py
```

The default input is `data/fake_job_postings.csv`. Use `--data`, `--results-dir`, or `--models-dir` to override paths. Run `python baseline/careerguard_block1_baseline.py --help` for all options.

## Leakage and evaluation controls

- Rows without usable text are excluded and exact feature duplicates are removed before splitting.
- A fixed random seed and stratification are used.
- TF-IDF vocabularies, categorical encoders, imputers, scalers, and classifiers are fitted on training data only through scikit-learn pipelines.
- Each decision threshold is selected only from validation scores by maximising F1; the higher threshold breaks exact ties.
- The test split is used once for final comparison.
- Ranking metrics and classification metrics are both exported. Latency is separated into repeated batch throughput and repeated single-record inference timing.

## Outputs

- `block1_models/`: fitted pipeline files plus selected thresholds.
- `block1_results/block1_model_results.csv`: final test-set metrics and timing.
- `block1_results/block1_ranking_by_k.csv`: Precision@K, Recall@K, and NDCG@K.
- `block1_results/block1_test_predictions.csv`: test labels, probabilities, and decisions.
- `block1_results/block1_split_ids.csv`: auditable split membership.
- `block1_results/block1_run_config.json`: dataset/script hashes, feature lists, split policy, seed, and software environment.
- `block1_results/block1_classification_reports.json` and `block1_confusion_matrices.csv`: class-wise and confusion-matrix evidence.
- `block1_results/block1_model_comparison.png` and `.svg`: comparison figure.

These are offline local-runtime measurements, not end-to-end browser latency measurements.
