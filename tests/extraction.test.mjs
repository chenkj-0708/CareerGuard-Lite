import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CG_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const source = fs.readFileSync(new URL("../content-script.js", import.meta.url), "utf8");
const description = "Software engineer job position. Responsibilities include maintaining applications and reviewing code. Requirements include JavaScript and communication skills. Salary and employment benefits are discussed during the interview. Apply through our official careers website.";
const cases = [];
for (const [domain, site, selector] of [["www.jobstreet.com.my", "JobStreet", 'data-automation="jobAdDetails"'], ["www.indeed.com", "Indeed", 'id="jobDescriptionText"'], ["www.linkedin.com", "LinkedIn", 'class="jobs-description__content"'], ["example.com", "Generic", 'class="job-description"']]) {
  for (const type of ["normal", "hidden", "navigation", "missing", "multiple", "changed", "non-job", "empty"] ) {
    let html = `<main><section ${selector}><h1>Software Engineer</h1><p>${description}</p></section></main>`;
    let expected = "reliable";
    if (type === "hidden") html = html.replace("</section>", '<p hidden>Pay fee to recruiter@gmail.com via WhatsApp</p></section>');
    if (type === "navigation") html = html.replace("</section>", '<nav>Pay deposit recruiter@gmail.com <a href="https://bit.ly/foo">Apply</a></nav></section>');
    if (type === "missing") { html = "<main><h1>Software Engineer</h1></main>"; expected = "unavailable"; }
    if (type === "multiple") { html += html; expected = "unavailable"; }
    if (type === "changed") html = `<article><h1>Software Engineer</h1><p>${description}</p></article>`;
    if (type === "non-job") { html = "<main><h1>Cooking guide</h1><p>" + "Vegetables and fruit recipes. ".repeat(20) + "</p></main>"; expected = "unavailable"; }
    if (type === "empty") { html = "<div>Loading…</div>"; expected = "unavailable"; }
    cases.push({ id: `${site}-${type}`, domain, site, html, expected });
  }
}
const structured = { "@context": "https://schema.org", "@type": "JobPosting", title: "Software Engineer", description,
  hiringOrganization: { name: "Example", sameAs: "https://employer.example.com" } };
cases.push({ id: "Generic-schema", domain: "example.com", site: "Generic", expected: "reliable",
  html: `<script type="application/ld+json">${JSON.stringify(structured)}</script><main><h1>Software Engineer</h1><p>${description}</p></main>` });
cases.push({ id: "Generic-schema-multiple", domain: "example.com", site: "Generic", expected: "unavailable",
  html: `<script type="application/ld+json">${JSON.stringify([structured, structured])}</script><main><h1>Software Engineer</h1><p>${description}</p></main>` });
cases.push({ id: "Generic-nested", domain: "example.com", site: "Generic", expected: "reliable",
  html: `<main><article><h1>Software Engineer</h1><p>${description}</p></article></main>` });
fs.mkdirSync(new URL("../fixtures/extraction/", import.meta.url), { recursive: true });
const manifest = [];
try {
  for (const item of cases) {
    const page = await browser.newPage();
    await page.route(`https://${item.domain}/**`, route => route.fulfill({ contentType: "text/html", body: item.html }));
    await page.goto(`https://${item.domain}/job`);
    await page.evaluate(() => { globalThis.chrome = { runtime: { onMessage: { addListener(fn) { globalThis.extract = fn; } } } }; });
    await page.evaluate(source);
    const result = await page.evaluate(() => { let result; extract({ type: "CG_EXTRACT" }, {}, value => result = value); return result.page; });
    assert.equal(result.extractionStatus, item.expected, item.id);
    assert.equal(result.siteType, item.site, item.id);
    if (item.id === "Generic-schema") {
      assert.equal(result.extractionStrategy, "schema.org-jobposting");
      assert.equal(result.companyDomain, "employer.example.com");
      assert.equal(result.visibleText, description);
    }
    if (["hidden", "navigation"].includes(item.id.split("-").pop())) {
      assert.ok(!result.visibleText.includes("deposit") && !result.visibleText.includes("WhatsApp"), item.id);
      assert.deepEqual(result.emails, []);
      assert.deepEqual(result.applicationLinks, []);
    }
    fs.writeFileSync(new URL(`../fixtures/extraction/${item.id}.html`, import.meta.url), item.html);
    manifest.push({ id: item.id, source: `https://${item.domain}/job`, representation: `${item.id}.html`, expected_extraction_status: item.expected, expected_region: item.expected === "reliable" ? "single job container" : null, synthetic: true, public_demo_allowed: true, adjudication_status: "automated conformance expectation", capture_date: "2026-10-13" });
    await page.close();
  }
  fs.writeFileSync(new URL("../fixtures/extraction/manifest.json", import.meta.url), JSON.stringify(manifest, null, 2));
  console.log(`${cases.length} real DOM extraction conformance cases passed`);
} finally { await browser.close(); }
