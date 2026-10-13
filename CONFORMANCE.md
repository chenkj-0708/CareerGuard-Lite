# Scoring authority contract and conformance record

The browser exclusively produces base scores, risk bands, local evidence, escalation decisions and recommended actions. Backend evidence can be supported, contradicted, unavailable or inconclusive, and cannot alter local scoring. Missing extraction stops all scoring.

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Supported site detection and bounded generic extraction | content-script.js | 35 real DOM fixtures in fixtures/extraction |
| No whole-body fallback or outside-container contact text | content-script.js | hidden/navigation/missing/multiple/non-job cases |
| Extraction diagnostic fields and safe stop | background.js; extractionFailures storage | workflow.test.mjs |
| Browser score authority | lib/scoring.js | scoring.test.mjs; workflow.test.mjs |
| Minimal derived-domain request | background.js | exact outbound schema assertion in workflow.test.mjs |
| RDAP, reachability and contact evidence | backend/verifier.py | mocked domain data, timeout and missing-domain tests |
| Backend offline or corrupted response retains local result | background.js | workflow.test.mjs |
| Restricted CORS, token freshness, nonce/request replay, rate and size limits | backend/server.py | test_backend.py, including actual localhost HTTP tests |
| External destination restrictions | backend/verifier.py | private-IP rejection test; redirect targets revalidated |
| Rule-derived scenarios preserved | fixtures/synthetic | synthetic-fixtures.test.mjs (40 cases) |
| Evaluation compatibility | analysis/evaluate.py | test_evaluate.py |

Tests use synthetic representations and mocked external data, not live-site reliability or final experimental performance. External RDAP network access and manual unpacked-extension operation need a user environment with network access. See README for the three supervision demos.

Remaining research checklist items: independent page annotations and live snapshots; extraction coverage on current platform markup; independent indicator validation and final freeze; near-duplicate-aware EMSCAD splits and expanded baseline comparison; formal benchmark metrics and error analysis. Existing historical evaluation files are preserved and should not be mixed with the remediated architecture.

RDAP references: https://about.rdap.org/ and https://www.rfc-editor.org/rfc/rfc9083.html.
