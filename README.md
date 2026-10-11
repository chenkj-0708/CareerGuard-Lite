# CareerGuard Lite browser research prototype

This folder contains the complete local-first prototype flow described in the FYP report:

1. page detection and visible job-text extraction;
2. live page-metadata extraction;
3. text-only, metadata-only and front-end multi-signal scoring;
4. an explainable result in the persistent side panel with score-only and explanation conditions;
5. selective verification through a localhost backend;
6. privacy-bounded evaluation logging and CSV/JSON export.

The browser scorers are transparent research heuristics. They are separate from the offline EMSCAD logistic-regression benchmark in `../baseline`; EMSCAD structured fields must not be described as live browser metadata.

## 1. Start the selective backend

The backend uses only the Python standard library:

```powershell
python extension/backend/server.py
```

It listens on `http://127.0.0.1:8765`. The backend performs deterministic checks for application-domain mismatch, shortened links, public-email contact, payment/sensitive-data wording and cross-domain duplicate fingerprints. It does not contact external reputation services and does not store raw listing text.

## 2. Load the extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `extension` folder.
5. Open a public job listing and click the CareerGuard Lite toolbar button. The interface opens in Chrome's persistent side panel.

The persistent side panel can remain open after navigation, so the extension declares access to public HTTP and HTTPS pages. Page extraction still occurs only when the user presses **Scan this listing**. Browser-internal pages such as `chrome://extensions` cannot be scanned.

Chrome controls whether side panels appear on the left or right. If the panel is not on the right, open Chrome Settings, search for **Side panel position**, and select **Show on right**. Once opened, the CareerGuard panel remains available while navigating between normal browser tabs until the user closes it.

For a controlled smoke test, serve the included fixtures in another terminal:

```powershell
python -m http.server 8000 --directory extension/fixtures
```

Then scan `http://127.0.0.1:8000/low.html`, `uncertain.html`, and `elevated.html`. These pages are test fixtures, not research data and must not be included as independent evaluation observations.

## 3. Scan and compare

The side panel uses the intended operational configuration automatically: front-end multi-signal scoring, explanations enabled, and selective backend checking enabled. The user only needs to press **Scan this listing**.

One scan calculates the text-only, metadata-only and multi-signal scores from the same extracted page. Uncertain/elevated multi-signal results are sent for selective backend verification. This avoids duplicate scans and input differences between methods. The dashboard stores up to 500 records locally and exports CSV/JSON.

The side panel displays only the operational CareerGuard result. The dashboard retains the internal baseline scores for research comparison. Equal baseline scores are possible when none of the text or metadata risk rules match. A score of `5` is the default low-concern starting score.

## 4. Evaluation protocol

Use saved or controlled public-page scenarios instead of relying only on changing live pages. Assign ground truth independently of model output. Use the same scenarios and risk-tier thresholds for every method. The popup does not contain an evaluator-response form. If an interface study is later conducted, collect participant feedback separately, counterbalance the conditions, and obtain the required ethics/participant approval.

The dashboard's current headline metric is three-class exact accuracy. Export JSON, then calculate the complete comparison metrics with:

```powershell
python extension/analysis/evaluate.py path/to/careerguard-evaluation.json --output extension/evaluation-results.json
```

The analysis script reports three-class accuracy, elevated-case precision/recall/F1, Precision@K, Recall@K, NDCG@K, latency, escalation rate, and any compatible externally collected interface-study records.

## 5. Tests

```powershell
node extension/tests/scoring.test.mjs
python -m unittest extension.tests.test_backend extension.tests.test_evaluate
```

## Important research boundary

This is an advisory prototype, not a fraud-determination system. The heuristic weights and 30/60 risk thresholds are initial implementation choices and must be calibrated on a validation set before final reporting. Do not claim the included rules have achieved final experimental performance until a labelled browser-scenario evaluation has been run.
