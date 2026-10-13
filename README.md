# CareerGuard Lite 0.2.0

This implementation follows the formal contracts in `../FYP Thesis/RSW_ChenKaiJian_FullText.pdf`, Chapters 3 and 4. It is an advisory research prototype, not a calibrated fraud classifier. The earlier domain/RDAP verifier is superseded by the thesis hash-only, read-only corroboration design.

## Run

Load this directory unpacked on the Chrome/Edge extensions page. Copy the extension ID and start the loopback backend:

```powershell
python backend/server.py --allowed-origin chrome-extension://YOUR_32_CHARACTER_EXTENSION_ID
```

An authorised index is optional for local operation. To enable actual duplicate context:

```powershell
python backend/server.py --allowed-origin chrome-extension://YOUR_32_CHARACTER_EXTENSION_ID --index-manifest path/to/authorised-manifest.json
```

An absent index returns unavailable. No real authorised index has been fabricated or shipped. The server validates the permission/source/construction/contamination manifest, index checksum and matching PSL/hash contracts. It loads a fixed snapshot, never inserts queried advertisements and performs no RDAP, reputation or other outbound lookup.

After updating, reload the extension and refresh existing job tabs. LinkedIn, JobStreet and Indeed (including the observed React Native viewjob layout) use bounded description selectors. Other pages use bounded, single-listing extraction. Unsupported/ambiguous content produces a limitation state and no score.

## Formal scoring

Each Table 4.7 rule contributes at most once. Text evidence starts at zero and has maximum 101; metadata evidence starts at zero and has maximum 49. Branch presentation scores are:

- `S_text = round(5 + 95 * min(E_text, 101) / 101)`
- `S_meta = round(5 + 95 * min(E_meta, 49) / 49)`
- `S_local = round(0.50 * S_text + 0.50 * S_meta)`

There is no shared-signal bonus. The display floor of 5 is not risk evidence. Tiers are low below 30, uncertain from 30 to below 60, and elevated from 60. Text scoring uses only title/company/visible text; metadata uses only the declared non-prose fields.

Metadata scored weights are HTTP 10, shortened application link 25, public email provider 8 and eight distinct external registrable domains 6. External application domains and messaging are zero-point context. Short descriptions and low extraction coverage are zero-point uncertainty. TXT_OFFPLATFORM suppresses the correlated META_MESSAGING display, and no experience required is not a screening trigger. Generic pay/payment does not trigger advance-fee scoring.

`lib/risk-rules.js` is the canonical inventory; `lib/indicator-catalog.json` records the versioned inventory. Negation, quotations, employer-payment policies and scam-warning sentences have a versioned context guard with positive/negative functional tests. These guards do not establish independent content validity.

The UI shows ExtractionSufficiency and TierBoundaryDistance rather than a fabricated confidence probability. Scored, context and uncertainty reasons are labelled separately. Local results appear while optional corroboration is pending.

## PageSignal v1 and domains

`lib/page-signal.js` validates the runtime object and `lib/page-signal.schema.json` documents fields. The root/status/confidence enumerations and fallback/truncation flags are explicit. Raw email addresses are reduced to `emailProvider` domains. URL parsing canonicalises the host; persisted references remove query and fragment. Title fallbacks and all text/link truncation are recorded. Transient visible text is capped at 30,000 Unicode code points, company text at 500, links at 100 and application links at 20.

The official PSL snapshot includes ICANN and PRIVATE sections, wildcard and exception rules. `lib/psl-manifest.json` records its version and checksum. Browser and Python index loading share this exact snapshot. Rebuild the JS module deterministically with `python scripts/build_psl.py`; changing the snapshot requires new manifests and affected conformance evidence.

## Hash-only request and timeout

The exact six-field VerifyRequest v1 is:

```json
{
  "requestId": "opaque-unique-request-id",
  "schemaVersion": 1,
  "scenarioOrScanId": "opaque-random-scan-id",
  "excerptHash": "64-lowercase-hexadecimal-SHA256-characters",
  "hashContractVersion": "HashNormalise-CORR-v1",
  "capabilityToken": "server-issued-random-capability"
}
```

The request contains no text, URL, domain, email, score, tier or label. HashNormalise-CORR v1 takes the first 2,500 plus last 2,500 Unicode code points if the text exceeds 5,000, then applies NFKC, lowercase, Unicode-whitespace collapse, trimming, UTF-8 and SHA-256. Punctuation, digits and token order remain. This concretely finalises the thesis's named hash contract using its documented duplicate-normalisation convention; it is recorded as an implementation choice before independent testing.

A single 2,000 ms deadline covers local hashing, token acquisition, POST and response parsing. Timeout, malformed response or unavailable index leaves every local score/tier/sufficiency/distance unchanged. A duplicate on at least three distinct PSL roots appends only the thesis zero-point contextual wording. Gate sensitivity at two and four domains is returned separately. No match does not establish uniqueness or safety.

The server binds to 127.0.0.1, requires an exact extension origin, enforces JSON and 4,096 bytes, issues 256-bit capabilities valid for at most two hours, rejects repeated request IDs within ten minutes and rate-limits requests. Capability freshness and server-side request-ID replay state replace the old extra timestamp/nonce payload fields so the request remains exactly six fields.

## RQ1 analysis

```powershell
python analysis/evaluate.py path/to/export.json --contract path/to/sealed-contract.json --output path/to/report.json
```

The export must contain independent reference annotations and a sealed `analysisContract`; a deliberately incomplete template is in `analysis/contract.template.json`. Each eligible record needs `scenarioId`, independent `groupId`, `split` (`validation`/`test`), `overlapCategory` (`DIRECT`/`RELATED`/`LOWER-OVERLAP`), `groundTruth`, `configId`, paired predictions and sensitivity predictions. Two original `annotatorLabels` and their `annotationProtocolVersion` are required for reliability gates. Labels/groups/overlap classifications must be joined independently after prediction; they are never inferred from system outputs or host platforms.

The runner selects text-only or metadata-only by validation group-averaged MAOE. It compares the fixed branch with 50/50 fusion on held-out groups, weights each independent group equally, and reports the paired delta, group bootstrap, corrections/worsenings, LOWER-OVERLAP and other strata, class metrics, macro F1, confusion matrices, weighted/unweighted kappa, branch floor/saturation distributions and reference agreement.

Predeclared sensitivity outputs include prior 58/42 weights, raw-evidence branch scaling, and 25/55 and 35/65 boundaries. The raw scaling (`min(100, 5 + E_branch)`) and text-only validation tie break are explicit implementation defaults because the thesis names these contracts without supplying those exact choices; they must be sealed before held-out access. Required lower-overlap group/class floors remain unset in the template and must be prospectively justified, never filled from outcomes.

Cross-split groups and conflicting technical repeats are rejected. Synthetic/forced runs and reference-insufficient/failure cases do not enter class-dependent RQ1 metrics. Technical repeats are deduplicated by scenario identity. Missing prospective gates, insufficient independent/class/lower-overlap support, low reference reliability or directional sensitivity reversal produce Inconclusive. No bootstrap resample count is treated as additional independent information. Ranking metrics are not formal browser outcomes. Existing exports from earlier configurations are retained but excluded from formal RQ1.

## Validation and research boundaries

```powershell
npm test
python -m unittest discover -s tests
```

For real DOM tests, install/use Playwright with Microsoft Edge and run:

```powershell
npm run test:extraction
```

Set `CG_PLAYWRIGHT` to an existing Playwright package directory if needed. Forty original rule-derived scenarios and the extraction representations are functional regression fixtures, not independent performance evidence; their old risk labels belong to the retired configuration and were not retuned to improve thesis results.

History retains at most 500 records and 30 days; lastScan expires after 24 hours. Stored outputs omit raw descriptions and matched text excerpts. Extraction failures are exported separately. Backend access logs contain bounded status/request IDs only; stdout storage is controlled by the operator, who must apply the thesis seven-day log retention requirement. No real held-out benchmark or annotation/index authorization is claimed by passing software tests. See CONFORMANCE.md for source mappings, explicit finalisation choices and remaining independent research gates.
