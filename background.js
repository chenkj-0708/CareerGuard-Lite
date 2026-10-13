import { combineBackend, scoreAll } from "./lib/scoring.js";

const DEFAULTS = {
  mode: "multiSignal",
  showReasons: true,
  autoEscalate: true,
  backendUrl: "http://127.0.0.1:8765"
};

const storageGet = (keys) => chrome.storage.local.get(keys);
const storageSet = (value) => chrome.storage.local.set(value);

async function configureSidePanel() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

configureSidePanel().catch((error) => console.error("Unable to configure side panel", error));

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active browser tab was found.");
  if (!/^https?:/i.test(tab.url || "")) {
    throw new Error(`This page cannot be scanned (${tab.url || "URL unavailable"}). Open a normal public website using HTTP or HTTPS.`);
  }
  return tab;
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] });
}

async function backendVerify(page, localResult, backendUrl) {
  if (backendUrl !== DEFAULTS.backendUrl) throw new Error("Only the configured localhost verifier is allowed.");
  const health = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(3000) });
  if (!health.ok) throw new Error("Backend unavailable.");
  const { token } = await health.json();
  const requestId = crypto.randomUUID();
  const response = await fetch(`${backendUrl}/verify`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({
      request_id: requestId, timestamp: Date.now() / 1000, nonce: crypto.randomUUID(),
      company_domain: page.companyDomain || "",
      contact_domain: [...new Set((page.emails || []).map(email => email.split("@").pop()))].length === 1
        ? page.emails[0].split("@").pop() : "",
      requested_checks: ["rdap_domain_registration", "website_reachable", "contact_domain_match"]
    })
  });
  if (!response.ok) throw new Error(`Backend verification failed (${response.status}).`);
  const result = await response.json();
  if (result.request_id !== requestId) throw new Error("Mismatched corroboration response.");
  return result;
}

async function scan(options = {}) {
  const settings = { ...DEFAULTS, ...(await storageGet(Object.keys(DEFAULTS))), ...options };
  const tab = await activeTab();
  const started = performance.now();
  await ensureContentScript(tab.id);
  const extracted = await chrome.tabs.sendMessage(tab.id, { type: "CG_EXTRACT" });
  if (!extracted?.ok) throw new Error("The listing could not be extracted.");

  const page = extracted.page;
  if (page.extractionStatus !== "reliable") {
    const { extractionFailures = [] } = await storageGet(["extractionFailures"]);
    await storageSet({ lastScan: null, extractionFailures: [...extractionFailures, {
      createdAt: new Date().toISOString(), domain: page.domain, siteType: page.siteType,
      extractionStatus: page.extractionStatus, extractionStrategy: page.extractionStrategy,
      selectedContainer: page.selectedContainer, missingFields: page.missingFields,
      fallbackReason: page.fallbackReason
    }].slice(-500) });
    throw new Error("Unable to reliably identify the job advertisement content.");
  }
  const scoringStarted = performance.now();
  const baselines = scoreAll(page);
  const localScoringLatencyMs = Number((performance.now() - scoringStarted).toFixed(2));
  const selected = baselines[settings.mode] || baselines.multiSignal;
  let finalResult = selected;
  let escalation = { attempted: false, status: "not-required" };
  const fullWorkflowEnabled = settings.forceEscalation || (settings.autoEscalate && settings.mode === "multiSignal");
  const shouldEscalate = settings.forceEscalation || (fullWorkflowEnabled && ["uncertain", "elevated"].includes(baselines.multiSignal.tier));

  if (shouldEscalate) {
    escalation = { attempted: true, status: "pending" };
    try {
      const backend = await backendVerify(page, baselines.multiSignal, settings.backendUrl);
      finalResult = combineBackend(baselines.multiSignal, backend);
      escalation = { attempted: true, status: "completed", backendLatencyMs: backend.latencyMs };
    } catch (error) {
      escalation = { attempted: true, status: "unavailable", error: error.message };
    }
  }

  const fullWorkflow = fullWorkflowEnabled
    ? finalResult.model === "full-workflow" ? finalResult : { ...baselines.multiSignal, model: "full-workflow", backend: null }
    : null;
  if (fullWorkflowEnabled) finalResult = fullWorkflow;

  const scanRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    page: {
      url: page.url,
      domain: page.domain,
      title: page.title,
      pageStatus: page.pageStatus,
      extractionQuality: page.extractionQuality,
      siteType: page.siteType, extractionStatus: page.extractionStatus,
      extractionStrategy: page.extractionStrategy, selectedContainer: page.selectedContainer,
      missingFields: page.missingFields, fallbackReason: page.fallbackReason,
      extractionLatencyMs: page.extractionLatencyMs,
      signalCounts: {
        visibleTextCharacters: page.visibleText.length,
        links: page.links.length,
        externalLinks: page.externalLinks.length,
        applicationLinks: page.applicationLinks.length,
        emails: page.emails.length,
        contactCues: page.contactCues.length
      }
    },
    baselines,
    fullWorkflow,
    selectedMode: settings.mode,
    interfaceCondition: settings.showReasons ? "explanation" : "score-only",
    displayedResult: finalResult,
    escalation,
    localScoringLatencyMs,
    totalLatencyMs: Number((performance.now() - started).toFixed(2)),
    groundTruth: null,
    participantResponse: null
  };

  const { scanLogs = [] } = await storageGet(["scanLogs"]);
  const nextLogs = [...scanLogs, scanRecord].slice(-500);
  await storageSet({ lastScan: scanRecord, scanLogs: nextLogs, ...Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, settings[key]])) });
  return scanRecord;
}

chrome.runtime.onInstalled.addListener(async () => {
  await configureSidePanel();
  const current = await storageGet(Object.keys(DEFAULTS));
  await storageSet(Object.fromEntries(Object.entries(DEFAULTS).filter(([key]) => current[key] === undefined)));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "CG_SCAN") {
    scan(message.options).then((record) => sendResponse({ ok: true, record })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "CG_ESCALATE") {
    scan({ ...message.options, mode: "multiSignal", forceEscalation: true }).then((record) => sendResponse({ ok: true, record })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
