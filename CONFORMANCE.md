# Thesis conformance record for CareerGuard Lite 0.2.0

Authority: `../FYP Thesis/RSW_ChenKaiJian_FullText.pdf`. PDF page numbers below are physical pages verified by extraction; the report's printed numbering is different.

| User issue | Formal source | Implemented change | Automated evidence |
| --- | --- | --- | --- |
| Fusion formula | PDF 79-80, Equations 4.1-4.4 | Zero-start evidence sums; 101/49 branch normalisation; 50/50 fusion; no shared bonus | scoring.test.mjs |
| Hash-only backend | PDF 75, 80-81, VerifyRequest/Algorithm 4.3 | Exactly six fields; local SHA-256; read-only manifest/checksummed index; no outgoing domain/RDAP lookup | hash.test.mjs; workflow.test.mjs; test_backend.py |
| Formal RQ1 | PDF 44-53, Chapter 3 | Validation-selected single branch, equal group MAOE, paired group bootstrap, lower-overlap, corrections/worsenings, sensitivity/kappa, support and integrity gates | test_rq1.py; test_evaluate.py |
| Two-second timeout | PDF 67, Table 4.2 | One 2,000 ms deadline over hashing/health/verify/parse; local output remains visible and unchanged | workflow.test.mjs, including a never-resolving backend |
| PageSignal v1 and PSL | PDF 73-74, Table 4.5 | Explicit schema/root/confidence/status/fallback/truncation fields; provider domains; local official PSL snapshot and browser/Python parity | extraction.test.mjs; scoring.test.mjs; test_backend.py |
| Formal indicators | PDF 76-78, Table 4.7 | Formal IDs, weights and triggers; once per rule; correlated messaging suppression; separate zero-weight context/uncertainty | scoring.test.mjs; indicator-catalog.json |

ScoreResult v1 reports ExtractionSufficiency and TierBoundaryDistance, not a probability/confidence claim. Second-stage evidence is isolated from local score, tier and reasons. Logs store derived identifiers and omit complete raw listing content and matched evidence excerpts. The 500-record/30-day history and 24-hour lastScan lifecycle are enforced on worker startup and scan.

The following were unspecified final implementation details in the thesis and are explicitly versioned here: PageSignal root/status/confidence enum values; HashNormalise-CORR v1's NFKC/lowercase/whitespace convention (same documented convention as DUP); the phrase context guard; text-only validation tie default; raw-evidence alternative-scaling formula. This record does not pretend the thesis itself supplied those exact details. These choices are now reviewable and require a sealed independent validation protocol before formal results.

The lower-overlap group/class minimum and independent precision justification are not invented. The analysis template leaves them unset or false and the runner caps unsupported synthesis at Inconclusive. A Partially Supported rule is not invented from outcomes; the implemented synthesis is deliberately conservative. Legacy historical evaluation exports are preserved and are not used to choose the new rules/weights.

The PSL source is https://publicsuffix.org/list/public_suffix_list.dat; the vendored source includes its MPL notice. Exact version/checksum are in lib/psl-manifest.json and browser/Python use the same snapshot. Index manifests must match that checksum and the hash contract. A populated, independently authorised pre-built index is not supplied; absence is unavailable, not safe/no-match. Supplied test indexes contain synthetic domains only and are never installed as operational index data.

Remaining independent research requirements are distinct from these software fixes: permitted saved browser scenarios, non-outcome sampling, independent annotation/adjudication competence and rubric/overlap sealing, exact/near-duplicate audits, information-size/precision justification, actual authorised index and usefulness judges for RQ3, and independent rule-content/error review. No completed held-out result, RQ3 usefulness or real-world fraud effectiveness is claimed. Backend stdout retention needs operator configuration because the server does not persist log files.

The earlier successful LinkedIn/Indeed selector fixes are retained, including Indeed's `.simple-job-description-html` layout. Extraction representations remain synthetic structural tests. Archive/checksum and executed test counts are recorded in output/thesis-conformance-run.json after validation.
