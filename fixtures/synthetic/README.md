# Synthetic CareerGuard listing scenarios

This folder contains 40 controlled, fictional job-listing pages:

- `uncertain-01.html` to `uncertain-20.html`
- `elevated-01.html` to `elevated-20.html`

Start a local fixture server from the repository root:

```powershell
python -m http.server 8000 --directory extension/fixtures/synthetic
```

Open a page such as `http://127.0.0.1:8000/uncertain-01.html` and scan it with CareerGuard Lite. The extractor uses the fixture's canonical `.example` source URL so URL/domain signals behave like a hosted page instead of treating localhost as the source.

Every page has a bottom-right **Next listing** button. Uncertain pages cycle only through uncertain scenarios, while elevated pages cycle only through elevated scenarios. Page 20 wraps back to page 1.

`scenario_manifest.csv` and `scenario_manifest.json` list the intended label and constructed warning signals for each page.

## Research limitation

These scenarios are synthetic fixtures created from the same warning logic used by the prototype. They are useful for functional testing, demonstrations, extraction checks and evaluator training. They must not be used as the only evidence of model accuracy because that would create circular evaluation. Final technical claims should use independently labelled real/public listings or saved public-page snapshots.
