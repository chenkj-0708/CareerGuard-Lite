(() => {
  // Re-injection replaces the previous extractor, including after an extension update.
  if (globalThis.__careerGuardExtractListener) {
    chrome.runtime.onMessage.removeListener(globalThis.__careerGuardExtractListener);
  }

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const visible = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || style.display === "none" || style.visibility === "hidden" || style.contentVisibility === "hidden") return false;
    }
    const hasBox = node => [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
    return hasBox(element) || (getComputedStyle(element).display === "contents" && [...element.children].some(hasBox));
  };

  function detectSite(domain) {
    if (/(^|\.)jobstreet\.(com|com\.my|com\.sg)$/.test(domain)) return "JobStreet";
    if (/(^|\.)indeed\.(com|co\.uk|ca|com\.au|de|fr|co\.in|co\.jp|nl|es|it|ch|ie|co\.nz|com\.br|com\.mx)$/.test(domain)) return "Indeed";
    if (/(^|\.)linkedin\.com$/.test(domain)) return "LinkedIn";
    return "Generic";
  }

  function bestListingRoot(siteType) {
    const siteSelectors = {
      JobStreet: ["[data-automation='jobAdDetails']", "[data-automation='jobDescription']"],
      Indeed: ["#jobDescriptionText", "[data-testid='jobDescriptionText']", "[data-testid='job-description']", ".jobsearch-JobComponent-description", ".simple-job-description-html", "[data-testid='vj-job-description-heading'] + .react-native-html-content"],
      LinkedIn: [".jobs-description-content__text", ".jobs-description__content", ".jobs-box__html-content", ".description__text .show-more-less-html__markup", ".description__text", "[data-testid='job-details-about-job-module']"]
    };
    // A platform's explicit description identifies the selected job, even on a
    // search page containing many cards or unrelated JobPosting JSON objects.
    const siteMatches = [...new Set((siteSelectors[siteType] || []).flatMap(selector => [...document.querySelectorAll(selector)]))]
      .filter(element => visible(element) && normalize(element.innerText).length >= 150);
    const siteCandidates = siteMatches.filter(element => !siteMatches.some(other => other !== element && element.contains(other)));
    if (siteCandidates.length > 1) return { reason: "multiple-listing-containers" };
    if (siteCandidates.length === 1) {
      const element = siteCandidates[0];
      return { element, strategy: "site-specific", selector: siteSelectors[siteType].find(selector => element.matches(selector)) };
    }
    if (["Indeed", "LinkedIn"].includes(siteType)) {
      const verificationHeading = [...document.querySelectorAll("h1")]
        .find(element => visible(element) && /additional verification required|verify (?:you are|you're) human/i.test(element.innerText));
      if (verificationHeading) return { reason: "verification-required" };
      // Never replace a still-loading selected description with the surrounding
      // search results, recommendations or other jobs on the same page.
      if (siteSelectors[siteType].some(selector => [...document.querySelectorAll(selector)].some(visible))) {
        return { reason: "description-not-ready" };
      }
    }
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
      if (description.length >= 150 && job.title &&
          visibleRoots.some(root => normalize(root.innerText).includes(description))) {
        return { element: visibleRoots.find(root => normalize(root.innerText).includes(description)),
          strategy: "schema.org-jobposting", selector: 'script[type="application/ld+json"]',
          description, job };
      }
    }
    const groups = [
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
        if (terms < 3) continue;
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
    const scanId = crypto.randomUUID();
    const capturedAt = new Date().toISOString();
    const rootSource = selection.strategy || "none";
    const statusCodes = { "multiple-listing-containers": "AMBIGUOUS_LISTINGS", "multiple-structured-listings": "AMBIGUOUS_LISTINGS", "multiple-listings": "AMBIGUOUS_LISTINGS", "verification-required": "SITE_VERIFICATION_REQUIRED", "description-not-ready": "DESCRIPTION_NOT_READY" };
    const failure = reason => ({
      schemaVersion: 1, scanId, capturedAt, domain: location.hostname, siteType,
      rootSource, selectorConfidence: "none", extractionStatusCode: statusCodes[reason] || (reason === "insufficient-visible-description" ? "INSUFFICIENT_VISIBLE_TEXT" : "NO_SINGLE_LISTING"),
      extractionQuality: 0, ExtractionSufficiency: 0, truncationFlags: { visibleText: false, companyText: false, links: false, applicationLinks: false },
      fallbackFlags: { title: false, companyText: false }, extractionStatus: "unavailable",
      extractionStrategy: "none", selectedContainer: null, missingFields: ["description"],
      fallbackReason: reason, pageStatus: "unsupported"
    });
    if (!root) return failure(selection.reason);
    // Only retain nodes that are visible in the original subtree.
    const originalNodes = [...root.querySelectorAll("*")];
    const clean = root.cloneNode(true);
    const cleanNodes = [...clean.querySelectorAll("*")];
    originalNodes.forEach((node, index) => {
      if (!visible(node) || node.matches("nav, footer, aside, script, style, [role='navigation'], [role='dialog'], .advertisement")) cleanNodes[index]?.remove();
    });
    clean.querySelectorAll("p, div, section, li, h1, h2, h3").forEach(node => node.append(" "));
    const fullVisibleText = selection.description || normalize(clean.textContent);
    const visibleText = Array.from(fullVisibleText).slice(0, 30000).join("");
    if (visibleText.length < 150) return failure("insufficient-visible-description");
    const pageText = visibleText;
    const siteHeadingSelectors = {
      LinkedIn: ".job-details-jobs-unified-top-card__job-title h1, .jobs-unified-top-card__job-title, .top-card-layout__title",
      Indeed: ".jobsearch-JobInfoHeader-title, [data-testid='jobsearch-JobInfoHeader-title'], [data-testid='company-info-title-row'] h5, [data-testid='company-info-title-row'] h1"
    };
    const siteHeading = siteHeadingSelectors[siteType]
      ? [...document.querySelectorAll(siteHeadingSelectors[siteType])].find(visible) : null;
    const heading = [...root.querySelectorAll("h1")].find(visible);
    const title = normalize(selection.job?.title || siteHeading?.innerText || heading?.innerText || document.title);
    const links = [...root.querySelectorAll("a[href]")]
      .filter(link => visible(link) && !link.closest("nav, footer, aside, [role='navigation'], [role='dialog']"))
      .map((link) => link.href)
      .filter((href) => /^https?:/i.test(href));
    const allLinks = [...new Set(links)];
    const uniqueLinks = allLinks.slice(0, 100);
    const fixtureSource = ["127.0.0.1", "localhost"].includes(location.hostname)
      ? document.querySelector('meta[name="careerguard-fixture-source-url"]')?.content
      : "";
    const effectiveUrl = fixtureSource && /^https?:\/\//i.test(fixtureSource) ? fixtureSource : location.href;
    const effectiveLocation = new URL(effectiveUrl);
    const pageDomain = effectiveLocation.hostname.replace(/^www\./, "").toLowerCase();
    const pageRootDomain = globalThis.CGDomain.registrableDomain(effectiveLocation.hostname);
    const externalLinks = uniqueLinks.filter((href) => {
      try { return globalThis.CGDomain.registrableDomain(globalThis.CGDomain.domainOf(href)) !== pageRootDomain; }
      catch { return false; }
    });
    const applicationLinks = [...root.querySelectorAll("a[href]")]
      .filter(link => visible(link) && !link.closest("nav, footer, aside, [role='navigation'], [role='dialog']"))
      .filter((link) => /apply|application|submit|register/i.test(`${link.innerText} ${link.getAttribute("aria-label") || ""}`))
      .map((link) => link.href)
      .filter((href) => /^https?:/i.test(href));
    const emails = [...new Set((pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((value) => value.toLowerCase()))].slice(0, 20);
    const emailProvider = [...new Set(emails.map(email => email.split("@").pop()))];
    const contactCues = [...new Set((pageText.match(/\b(WhatsApp|Telegram|WeChat|Signal)\b/gi) || []).map((value) => value.toLowerCase()))];
    const jobTerms = (pageText.match(/\b(job|vacancy|position|responsibilities|requirements|apply|salary|employment)\b/gi) || []).length;
    const extractionQuality = Number(Math.min(1, (visibleText.length / 1200) * 0.65 + Math.min(jobTerms, 8) / 8 * 0.35).toFixed(3));
    const status = "scoreable";

    const fullCompanyText = normalize(selection.job?.hiringOrganization?.name || root.querySelector("[class*='company'], [data-testid*='company']")?.textContent);
    const companyText = Array.from(fullCompanyText).slice(0, 500).join("");
    return {
      schemaVersion: 1, scanId,
      rootSource, selectorConfidence: selection.strategy === "bounded-generic" ? "bounded" : "high",
      extractionStatusCode: "OK", ExtractionSufficiency: Math.round(100 * extractionQuality),
      truncationFlags: { visibleText: Array.from(fullVisibleText).length > 30000, companyText: Array.from(fullCompanyText).length > 500, links: allLinks.length > 100, applicationLinks: new Set(applicationLinks).size > 20 },
      fallbackFlags: { title: !selection.job?.title && !siteHeading && !heading, companyText: false },
      siteType, extractionStatus: "reliable", extractionStrategy: selection.strategy,
      selectedContainer: selection.selector, missingFields: companyText ? [] : ["companyText"], fallbackReason: null,
      excludedRegions: ["outside selected container"],
      capturedAt,
      url: effectiveUrl,
      protocol: effectiveLocation.protocol,
      domain: pageDomain,
      title,
      companyText,
      visibleText,
      links: uniqueLinks,
      externalLinks,
      applicationLinks: [...new Set(applicationLinks)].slice(0, 20),
      emailProvider,
      contactCues,
      extractionQuality: Number(extractionQuality.toFixed(3)),
      pageStatus: status,
      extractionLatencyMs: Number((performance.now() - started).toFixed(2))
    };
  }

  async function extractWhenReady(waitForContent) {
    const started = performance.now();
    const deadline = started + (waitForContent ? 5000 : 0);
    let page = extractPage();
    while (page.extractionStatus !== "reliable" && performance.now() < deadline &&
           page.fallbackReason !== "multiple-listing-containers" && page.fallbackReason !== "multiple-structured-listings") {
      await new Promise(resolve => setTimeout(resolve, 200));
      page = extractPage();
    }
    page.extractionLatencyMs = Number((performance.now() - started).toFixed(2));
    return page;
  }

  const listener = (message, _sender, sendResponse) => {
    if (message.type !== "CG_EXTRACT") return;
    extractWhenReady(message.waitForContent !== false)
      .then(page => sendResponse({ ok: true, page }))
      .catch(() => sendResponse({ ok: false, error: "The listing could not be extracted." }));
    return true;
  };
  globalThis.__careerGuardExtractListener = listener;
  chrome.runtime.onMessage.addListener(listener);
})();
