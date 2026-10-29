export const PAGE_SIGNAL_VERSION = 1;
export const ROOT_SOURCES = Object.freeze(["site-specific", "schema.org-jobposting", "jobposting", "job-description", "bounded-generic", "none"]);
export const STATUS_CODES = Object.freeze(["OK", "AMBIGUOUS_LISTINGS", "SITE_VERIFICATION_REQUIRED", "DESCRIPTION_NOT_READY", "NO_SINGLE_LISTING", "INSUFFICIENT_VISIBLE_TEXT"]);
export function validatePageSignal(page) {
  if (!page || page.schemaVersion !== 1 || typeof page.scanId !== "string" ||
      !ROOT_SOURCES.includes(page.rootSource) || !STATUS_CODES.includes(page.extractionStatusCode) ||
      !["high", "bounded", "none"].includes(page.selectorConfidence) ||
      !["scoreable", "unsupported", "extraction-limited"].includes(page.pageStatus) ||
      !Number.isFinite(page.extractionQuality) || page.extractionQuality < 0 || page.extractionQuality > 1 ||
      page.ExtractionSufficiency !== Math.round(100 * page.extractionQuality) ||
      !page.truncationFlags || !page.fallbackFlags || "emails" in page) throw new Error("Invalid PageSignal v1.");
  if (page.pageStatus === "scoreable") {
    if (page.extractionStatus !== "reliable" || page.rootSource === "none" ||
        typeof page.visibleText !== "string" || Array.from(page.visibleText).length > 30000 ||
        typeof page.companyText !== "string" || Array.from(page.companyText).length > 500 ||
        !Array.isArray(page.links) || page.links.length > 100 ||
        !Array.isArray(page.applicationLinks) || page.applicationLinks.length > 20 ||
        !Array.isArray(page.emailProvider) || !Array.isArray(page.contactCues)) throw new Error("Invalid scoreable PageSignal v1.");
    const url = new URL(page.url);
    if (!/^https?:$/.test(url.protocol) || page.protocol !== url.protocol || page.domain !== url.hostname.toLowerCase().replace(/^www\./, "")) throw new Error("Invalid PageSignal URL.");
  }
  return page;
}
