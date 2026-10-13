# CareerGuard Lite

Local browser risk triage with evidence-only external corroboration. This research prototype is advisory; its heuristic scores are not calibrated fraud probabilities.

## Load and run

1. In Chrome or Edge, open the extensions page, enable Developer mode and load this `CareerGuard-Lite` directory unpacked.
2. Copy its extension ID from that page.
3. From this directory, start the backend with the exact extension origin:

```powershell
python backend/server.py --allowed-origin chrome-extension://YOUR_32_CHARACTER_EXTENSION_ID
```

The verifier binds only to `127.0.0.1:8765`. Requests from other origins are rejected, including ordinary website JavaScript. The dashboard health button therefore works from the extension itself. A health response issues a single-use token valid for 60 seconds; verify requests also require a fresh timestamp, unique request ID and nonce. The global limit is 30 requests per minute, including health and preflight requests. Request bodies are limited to 4096 bytes.

4. Open a single job advertisement, click the extension toolbar icon, then **Scan this listing**.

JobStreet, Indeed and LinkedIn have explicit selectors. Other pages use a single bounded job container or a visible Schema.org JobPosting description. No whole-body fallback exists. Missing, ambiguous and unsupported content stops scoring with `Unable to reliably identify the job advertisement content.` Selectors are prototype coverage and require validation on permitted live snapshots before formal experiments.

## Scoring authority and privacy

The browser owns all scores, tiers, explanations and escalation decisions. Uncertain/elevated multi-signal results request corroboration. The full-workflow score and tier equal the local multi-signal result; external evidence never reweights them.

The entire outbound JSON schema is:

```json
{
  "request_id": "unique-request-identifier",
  "timestamp": 1791849600,
  "nonce": "unique-request-nonce",
  "company_domain": "example.com",
  "contact_domain": "mail.example.com",
  "requested_checks": ["rdap_domain_registration", "website_reachable", "contact_domain_match"]
}
```

No advertisement text, title, URL path, email local part or local risk score is sent. Employer domains must be explicitly present in JobPosting organization data or an employer link; the platform domain is never silently substituted. Missing employer/contact evidence is inconclusive. Multiple contact domains are withheld rather than choosing one arbitrarily.

The backend returns structured statuses and evidence for domain registration, HTTPS reachability and domain correspondence. RDAP uses the rdap.org bootstrap service; registration events follow RFC 9083. Domain age is evidence, never a scam conclusion. Network failures are unavailable. Outbound connections reject non-public IPs, pin checked destinations and validate redirects. The external providers receive the queried domain and backend network address.

Local records retain scores, indicator evidence, extraction diagnostics and page identifiers, but not the full description. Extraction failures are stored separately as `extractionFailures`, with no fabricated score. Backend stdout logs contain request identifiers, time, check type, status, response time and error class; they omit request bodies and tokens. Restart clears in-memory replay/token state.

## Tests and reproducible representations

```powershell
npm test
python -m unittest discover -s tests
```

Real browser DOM conformance tests need Playwright and installed Microsoft Edge:

```powershell
npm install --no-save playwright
npm run test:extraction
```

Alternatively set `CG_PLAYWRIGHT` to an existing Playwright package directory. The extraction runner intercepts network responses with synthetic HTML and writes 35 archived representations plus a manifest under `fixtures/extraction`. These establish implementation conformance, not independent risk-classification performance. Existing `fixtures/synthetic` cases likewise are rule-derived regression scenarios.

For a manual demo:

```powershell
python -m http.server 8000 --directory fixtures
```

Scan `http://127.0.0.1:8000/elevated.html`, stop the backend and rescan, then scan a non-job page. Confirm that the same local result survives backend failure and unsupported extraction produces no score. Inspect the extension service worker Network panel to verify the minimal JSON payload.

The dashboard exports local CSV/JSON. Older records may reflect the previous backend-weighted design; clear or archive them before collecting new results. Analyse labelled exports using:

```powershell
python analysis/evaluate.py path/to/careerguard-evaluation.json --output evaluation-results.json
```

## Research boundaries

Rule version 1.0.0 preserves existing initial weights and thresholds (30/60). Text indicators, metadata weights and thresholds are separated in `lib/risk-rules.js`; `lib/indicator-catalog.json` documents triggers and evidence sources; keyword evidence accompanies matching text rules. Broad keywords can cause false positives and require validation before a formal freeze. Do not tune these rules against a held-out test set.

The offline EMSCAD experiment is in `../Baseline`, separate from browser metadata and operational tests. Its current split removes exact duplicates, but does not establish protection against near-duplicate leakage. Independent scenario annotations, permitted live-site snapshots, near-duplicate-aware EMSCAD splits, at least two suitable baseline families and a formal benchmark remain research work. No new accuracy or publication claim is made by these fixes.
