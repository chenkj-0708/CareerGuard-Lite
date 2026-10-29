import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CG_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const pslSource = fs.readFileSync(new URL("../lib/public-suffix.js", import.meta.url), "utf8");
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
const creativeDescription = "About the role. Your content has one job: help people discover our products. Create, shoot and edit videos, review weekly analytics and develop concepts with our creative team. Bring a strong portfolio, clear communication and experience in short-form storytelling. Fresh graduates are welcome to share their work.";
const adminDescription = "Prepare quotations, maintain pricing records and liaise with customers and suppliers. Keep administrative documents organised and support the team with accurate data entry. Proficiency in spreadsheets and good communication are essential. Training is provided and candidates should be comfortable working with numerical information.";
cases.push({ id: "LinkedIn-reported-public-layout", domain: "www.linkedin.com", site: "LinkedIn", expected: "reliable", expectedStrategy: "site-specific",
  html: `<main><h1 class="top-card-layout__title">Content Producer</h1><section class="description"><div class="description__text"><section class="show-more-less-html"><div class="show-more-less-html__markup">${creativeDescription}</div></section></div></section><section><h1>Similar jobs</h1><p>Unrelated recommendation recruiter@gmail.com</p></section></main>` });
cases.push({ id: "LinkedIn-signed-in-display-contents", domain: "www.linkedin.com", site: "LinkedIn", expected: "reliable", expectedStrategy: "site-specific",
  html: `<main><section class="jobs-description__content"><div class="jobs-description-content__text" style="display:contents"><p>${creativeDescription}</p></div></section></main>` });
cases.push({ id: "Indeed-malaysia-no-keywords", domain: "malaysia.indeed.com", site: "Indeed", expected: "reliable", expectedStrategy: "site-specific",
  html: `<main><h1 class="jobsearch-JobInfoHeader-title">Pricing Admin</h1><div id="jobDescriptionText"><h1>Overview</h1><p>${adminDescription}</p><h1>Benefits</h1><p>Medical benefits and training.</p></div></main>` });
cases.push({ id: "Indeed-regional-alternate-selector", domain: "ca.indeed.com", site: "Indeed", expected: "reliable", expectedStrategy: "site-specific",
  html: `<div data-testid="job-description"><p>${adminDescription}</p></div>` });
cases.push({ id: "Indeed-selected-job-with-many-schema-cards", domain: "malaysia.indeed.com", site: "Indeed", expected: "reliable", expectedStrategy: "site-specific",
  html: `<script type="application/ld+json">${JSON.stringify([structured, structured])}</script><main><h1>Search results</h1><aside>Pay a deposit recruiter@gmail.com</aside><div id="jobDescriptionText"><p>${adminDescription}</p></div></main>` });
cases.push({ id: "Indeed-delayed-description", domain: "malaysia.indeed.com", site: "Indeed", expected: "reliable", expectedStrategy: "site-specific", waitForContent: true,
  html: `<main><h1>Pricing Admin</h1><aside>${description} unrelated recommendations recruiter@gmail.com</aside><div id="jobDescriptionText">Loading...</div></main>`, delayedDescription: adminDescription });
cases.push({ id: "Indeed-verification-wall", domain: "malaysia.indeed.com", site: "Indeed", expected: "unavailable",
  html: `<main><h1>Additional Verification Required</h1><p>${"Please verify you are human. ".repeat(8)}</p></main>` });
cases.push({ id: "Indeed-reported-react-native-layout", domain: "malaysia.indeed.com", site: "Indeed", expected: "reliable", expectedStrategy: "site-specific",
  html: `<div><nav>Unrelated navigation recruiter@gmail.com</nav><div data-testid="company-info-title-row"><h5>TVET/Certification Program</h5></div><div><h4 data-testid="vj-job-description-heading">Full job description</h4><div class="react-native-html-content simple-job-description-html"><p>${adminDescription}</p></div></div><footer>Unrelated footer WhatsApp contact</footer></div>` });
cases.push({ id: "Indeed-description-heading-sibling", domain: "malaysia.indeed.com", site: "Indeed", expected: "reliable", expectedStrategy: "site-specific",
  html: `<div><h4 data-testid="vj-job-description-heading">Full job description</h4><div class="react-native-html-content"><p>${adminDescription}</p></div></div>` });
cases.push({ id: "Indeed-unrelated-react-native-content", domain: "malaysia.indeed.com", site: "Indeed", expected: "unavailable",
  html: `<div class="react-native-html-content"><p>${description}</p></div>` });
cases.push({ id: "Indeed-pagesignal-caps", domain: "malaysia.indeed.com", site: "Indeed", expected: "reliable", expectedStrategy: "site-specific",
  html: `<div id="jobDescriptionText"><div class="company">${"Example ".repeat(100)}</div><p>${description.repeat(130)}</p>${Array.from({length:110},(_,i)=>`<a href="https://target${i}.com/apply">Apply</a>`).join("")} recruiter@gmail.com recruiter2@gmail.com</div>` });
fs.mkdirSync(new URL("../fixtures/extraction/", import.meta.url), { recursive: true });
const manifest = [];
try {
  for (const item of cases) {
    const page = await browser.newPage();
    await page.route(`https://${item.domain}/**`, route => route.fulfill({ contentType: "text/html", body: item.html }));
    await page.goto(`https://${item.domain}/job`);
    await page.evaluate(() => { globalThis.chrome = { runtime: { onMessage: {
      addListener(fn) { globalThis.extract = fn; }, removeListener(fn) { if (globalThis.extract === fn) globalThis.extract = null; }
    } } }; });
    await page.evaluate(pslSource);
    await page.evaluate(source);
    if (item.delayedDescription) await page.evaluate(text => setTimeout(() => { document.getElementById("jobDescriptionText").textContent = text; }, 350), item.delayedDescription);
    await page.evaluate(source);
    const result = await page.evaluate(waitForContent => new Promise(resolve => {
      extract({ type: "CG_EXTRACT", waitForContent }, {}, value => resolve(value.page));
    }), item.waitForContent || false);
    assert.equal(result.extractionStatus, item.expected, item.id);
    assert.equal(result.siteType, item.site, item.id);
    assert.equal(result.schemaVersion, 1);
    assert.ok(result.scanId);
    assert.ok(!("emails" in result));
    assert.equal(result.ExtractionSufficiency, Math.round(100 * result.extractionQuality));
    assert.ok(result.rootSource && result.extractionStatusCode && result.truncationFlags);
    if (item.expected === "reliable") assert.equal(result.pageStatus, "scoreable");
    if (item.id === "Indeed-pagesignal-caps") {
      assert.equal(Array.from(result.visibleText).length, 30000);
      assert.equal(Array.from(result.companyText).length, 500);
      assert.equal(result.links.length, 100);
      assert.equal(result.applicationLinks.length, 20);
      assert.deepEqual(result.truncationFlags, { visibleText: true, companyText: true, links: true, applicationLinks: true });
    }
    if (item.expectedStrategy) assert.equal(result.extractionStrategy, item.expectedStrategy, item.id);
    if (item.id === "Indeed-reported-react-native-layout") {
      assert.equal(result.selectedContainer, ".simple-job-description-html");
      assert.equal(result.title, "TVET/Certification Program");
      assert.equal(result.visibleText, adminDescription);
      assert.deepEqual(result.emailProvider, []);
      assert.deepEqual(result.contactCues, []);
    }
    if (item.id === "Indeed-delayed-description") {
      assert.ok(result.extractionLatencyMs >= 300);
      assert.deepEqual(result.emailProvider, []);
      assert.ok(!result.visibleText.includes("unrelated recommendations"));
    }
    if (item.id === "Indeed-verification-wall") assert.equal(result.fallbackReason, "verification-required");
    if (item.id === "LinkedIn-reported-public-layout") {
      assert.equal(result.title, "Content Producer");
      assert.deepEqual(result.emailProvider, []);
    }
    if (item.id === "Generic-schema") {
      assert.equal(result.extractionStrategy, "schema.org-jobposting");
      assert.equal(result.schemaVersion, 1);
      assert.equal(result.visibleText, description);
    }
    if (["hidden", "navigation"].includes(item.id.split("-").pop())) {
      assert.ok(!result.visibleText.includes("deposit") && !result.visibleText.includes("WhatsApp"), item.id);
      assert.deepEqual(result.emailProvider, []);
      assert.deepEqual(result.applicationLinks, []);
    }
    fs.writeFileSync(new URL(`../fixtures/extraction/${item.id}.html`, import.meta.url), item.html);
    manifest.push({ id: item.id, source: `https://${item.domain}/job`, representation: `${item.id}.html`, expected_extraction_status: item.expected, expected_region: item.expected === "reliable" ? "single job container" : null, synthetic: true, public_demo_allowed: true, adjudication_status: "automated conformance expectation", capture_date: "2026-10-13" });
    await page.close();
  }
  fs.writeFileSync(new URL("../fixtures/extraction/manifest.json", import.meta.url), JSON.stringify(manifest, null, 2));
  console.log(`${cases.length} real DOM extraction conformance cases passed`);
} finally { await browser.close(); }
