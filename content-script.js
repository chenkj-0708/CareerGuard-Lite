(() => {
  if (globalThis.__careerGuardInstalled) return;
  globalThis.__careerGuardInstalled = true;

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  function detectSite(domain) {
    if (/(^|\.)jobstreet\.(com|com\.my|com\.sg)$/.test(domain)) return "JobStreet";
    if (/(^|\.)indeed\.(com|co\.uk)$/.test(domain)) return "Indeed";
    if (/(^|\.)linkedin\.com$/.test(domain)) return "LinkedIn";
    return "Generic";
  }

  function bestListingRoot(siteType) {
    const siteSelectors = {
      JobStreet: ["[data-automation='jobAdDetails']", "[data-automation='jobDescription']"],
      Indeed: ["#jobDescriptionText"],
      LinkedIn: [".jobs-description__content", ".show-more-less-html__markup"]
    };
    const structuredJobs = [];
    const visit = value => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if ([].concat(value["@type"] || []).includes("JobPosting")) structuredJobs.push(value);
      if (value["@graph"]) visit(value["@graph"]);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { visit(JSON.parse(script.textContent)); } catch {}
    }
    if (structuredJobs.length > 1) return { reason: "multiple-structured-listings" };
    if (structuredJobs.length === 1) {
      const job = structuredJobs[0];
      const template = document.createElement("template");
      template.innerHTML = typeof job.description === "string" ? job.description : "";
      template.content.querySelectorAll("script, style, iframe").forEach(node => node.remove());
      const description = normalize(template.content.textContent);
      const visibleRoots = [...document.querySelectorAll("main, article, [role='main']")].filter(visible);
      if (description.length >= 150 && description.length <= 30000 && job.title &&
          visibleRoots.some(root => normalize(root.innerText).includes(description))) {
        return { element: visibleRoots.find(root => normalize(root.innerText).includes(description)),
          strategy: "schema.org-jobposting", selector: 'script[type="application/ld+json"]',
          description, job };
      }
    }
    const groups = [
      ["site-specific", siteSelectors[siteType] || []],
      ["jobposting", ["[itemtype*='JobPosting']"]],
      ["job-description", [".job-description", "#job-description", "[data-testid='job-description']"]],
      ["bounded-generic", ["main", "article", "[role='main']"]]
    ];
    for (const [strategy, selectors] of groups) {
      const matches = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))]
        .filter(element => visible(element) && normalize(element.innerText).length >= 150);
      const candidates = matches.filter(element => !matches.some(other => other !== element && element.contains(other)));
      if (candidates.length > 1) return { reason: "multiple-listing-containers" };
      if (candidates.length === 1) {
        const element = candidates[0];
        const headings = element.querySelectorAll("h1");
        const text = normalize(element.innerText);
        const terms = (text.match(/\b(job|role|vacancy|position|responsibilities|requirements|apply|salary|employment)\b/gi) || []).length;
        if (headings.length > 1 || element.querySelectorAll("[itemtype*='JobPosting']").length > 1) return { reason: "multiple-listings" };
        if (text.length > 30000 || terms < 3) continue;
        return { element, job: structuredJobs[0], strategy, selector: selectors.find(selector => element.matches(selector)) };
      }
    }
    return { reason: "no-reliable-single-listing-container" };
  }

  function extractPage() {
    const started = performance.now();
    const siteType = detectSite(location.hostname.toLowerCase());
    const selection = bestListingRoot(siteType);
    const root = selection.element;
    if (!root) return {
      domain: location.hostname, siteType, extractionStatus: "unavailable",
      extractionStrategy: "none", selectedContainer: null, missingFields: ["description"],
      fallbackReason: selection.reason, pageStatus: "unsupported"
    };
    // Only retain nodes that are visible in the original subtree.
    const originalNodes = [...root.querySelectorAll("*")];
    const clean = root.cloneNode(true);
    const cleanNodes = [...clean.querySelectorAll("*")];
    originalNodes.forEach((node, index) => {
      if (!visible(node) || node.matches("nav, footer, aside, script, style, [role='navigation'], [role='dialog'], .advertisement")) cleanNodes[index]?.remove();
    });
    clean.querySelectorAll("p, div, section, li, h1, h2, h3").forEach(node => node.append(" "));
    const visibleText = selection.description || normalize(clean.textContent).slice(0, 30000);
    if (visibleText.length < 150) return { extractionStatus: "unavailable", fallbackReason: "insufficient-visible-description" };
    const pageText = visibleText;
    const heading = [...root.querySelectorAll("h1")].find(visible);
    const title = normalize(selection.job?.title || heading?.innerText || document.title);
    const links = [...root.querySelectorAll("a[href]")]
      .filter(link => visible(link) && !link.closest("nav, footer, aside, [role='navigation'], [role='dialog']"))
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
      .filter(link => visible(link) && !link.closest("nav, footer, aside, [role='navigation'], [role='dialog']"))
      .filter((link) => /apply|application|submit|register/i.test(`${link.innerText} ${link.getAttribute("aria-label") || ""}`))
      .map((link) => link.href)
      .filter((href) => /^https?:/i.test(href));
    const emails = [...new Set((pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((value) => value.toLowerCase()))].slice(0, 20);
    const contactCues = [...new Set((pageText.match(/\b(WhatsApp|Telegram|WeChat|Signal)\b/gi) || []).map((value) => value.toLowerCase()))];
    const jobTerms = (pageText.match(/\b(job|vacancy|position|responsibilities|requirements|apply|salary|employment)\b/gi) || []).length;
    const extractionQuality = Math.min(1, (visibleText.length / 1200) * 0.65 + Math.min(jobTerms, 8) / 8 * 0.35);
    const status = visibleText.length < 150 ? "unsupported" : jobTerms >= 3 ? "likely-listing" : "possible-listing";

    const companyLink = root.querySelector("[itemprop='hiringOrganization'] a[href], a[data-company-domain]");
    let companyDomain = "";
    try { companyDomain = new URL(selection.job?.hiringOrganization?.sameAs || companyLink.href).hostname.toLowerCase().replace(/^www\./, ""); } catch {}
    return {
      companyDomain,
      schemaVersion: 2,
      siteType, extractionStatus: "reliable", extractionStrategy: selection.strategy,
      selectedContainer: selection.selector, missingFields: companyDomain ? [] : ["company_domain"], fallbackReason: null,
      excludedRegions: ["outside selected container"],
      capturedAt: new Date().toISOString(),
      url: effectiveUrl,
      protocol: effectiveLocation.protocol,
      domain: pageDomain,
      title,
      companyText: normalize(root.querySelector("[class*='company'], [data-testid*='company']")?.textContent).slice(0, 500),
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
