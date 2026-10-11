(() => {
  if (globalThis.__careerGuardInstalled) return;
  globalThis.__careerGuardInstalled = true;

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  function bestListingRoot() {
    const selectors = [
      "[itemtype*='JobPosting']", "main", "article", "[role='main']",
      ".job-description", "#job-description", "[data-testid*='job']"
    ];
    const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const scored = candidates
      .map((element) => ({ element, length: normalize(element.innerText).length }))
      .filter((item) => item.length >= 200)
      .sort((a, b) => b.length - a.length);
    return scored[0]?.element || document.body;
  }

  function extractPage() {
    const started = performance.now();
    const root = bestListingRoot();
    const visibleText = normalize(root.innerText).slice(0, 30000);
    const pageText = normalize(document.body?.innerText).slice(0, 50000);
    const heading = [...document.querySelectorAll("h1")].find(visible);
    const title = normalize(heading?.innerText || document.title);
    const links = [...root.querySelectorAll("a[href]")]
      .filter(visible)
      .map((link) => link.href)
      .filter((href) => /^https?:/i.test(href));
    const uniqueLinks = [...new Set(links)].slice(0, 100);
    const fixtureSource = ["127.0.0.1", "localhost"].includes(location.hostname)
      ? document.querySelector('meta[name="careerguard-fixture-source-url"]')?.content
      : "";
    const effectiveUrl = fixtureSource && /^https?:\/\//i.test(fixtureSource) ? fixtureSource : location.href;
    const effectiveLocation = new URL(effectiveUrl);
    const pageDomain = effectiveLocation.hostname.replace(/^www\./, "").toLowerCase();
    const externalLinks = uniqueLinks.filter((href) => {
      try { return new URL(href).hostname.replace(/^www\./, "").toLowerCase() !== pageDomain; }
      catch { return false; }
    });
    const applicationLinks = [...root.querySelectorAll("a[href]")]
      .filter(visible)
      .filter((link) => /apply|application|submit|register/i.test(`${link.innerText} ${link.getAttribute("aria-label") || ""}`))
      .map((link) => link.href)
      .filter((href) => /^https?:/i.test(href));
    const emails = [...new Set((pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((value) => value.toLowerCase()))].slice(0, 20);
    const contactCues = [...new Set((pageText.match(/\b(WhatsApp|Telegram|WeChat|Signal)\b/gi) || []).map((value) => value.toLowerCase()))];
    const jobTerms = (pageText.match(/\b(job|vacancy|position|responsibilities|requirements|apply|salary|employment)\b/gi) || []).length;
    const extractionQuality = Math.min(1, (visibleText.length / 1200) * 0.65 + Math.min(jobTerms, 8) / 8 * 0.35);
    const status = visibleText.length < 150 ? "unsupported" : jobTerms >= 3 ? "likely-listing" : "possible-listing";

    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      url: effectiveUrl,
      protocol: effectiveLocation.protocol,
      domain: pageDomain,
      title,
      companyText: normalize(document.querySelector("[class*='company'], [data-testid*='company']")?.textContent).slice(0, 500),
      visibleText,
      links: uniqueLinks,
      externalLinks,
      applicationLinks: [...new Set(applicationLinks)].slice(0, 20),
      emails,
      contactCues,
      extractionQuality: Number(extractionQuality.toFixed(3)),
      pageStatus: status,
      extractionLatencyMs: Number((performance.now() - started).toFixed(2))
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "CG_EXTRACT") sendResponse({ ok: true, page: extractPage() });
  });
})();
