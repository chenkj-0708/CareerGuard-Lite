import { combineBackend, scoreAll } from "./lib/scoring.js";
import { validatePageSignal } from "./lib/page-signal.js";
import { excerptHash, HASH_CONTRACT_VERSION } from "./lib/hash-contract.js";

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
  await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/public-suffix.js", "content-script.js"] });
}

export const BACKEND_TIMEOUT_MS = 2000;
async function backendVerify(page, localResult, backendUrl) {
  if (backendUrl !== DEFAULTS.backendUrl) throw new Error("Only the configured localhost verifier is allowed.");
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("Corroboration timeout.")); }, BACKEND_TIMEOUT_MS);
  });
  const started = performance.now();
  const task = (async () => {
    // One deadline covers hashing, token acquisition, request and response decoding.
    const hash = await excerptHash(page.visibleText);
    if (controller.signal.aborted) throw new Error("Corroboration timeout.");
    const health = await fetch(`${backendUrl}/health`, { signal: controller.signal });
    if (!health.ok) throw new Error("Backend unavailable.");
    const { token } = await health.json();
    const requestId = crypto.randomUUID();
    const response = await fetch(`${backendUrl}/verify`, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, schemaVersion: 1,
        scenarioOrScanId: page.scanId || crypto.randomUUID(), excerptHash: hash,
        hashContractVersion: HASH_CONTRACT_VERSION, capabilityToken: token })
    });
    if (!response.ok) throw new Error(`Backend verification failed (${response.status}).`);
    const result = await response.json();
    if (controller.signal.aborted || performance.now() - started >= BACKEND_TIMEOUT_MS) throw new Error("Corroboration timeout.");
    if (result.requestId !== requestId) throw new Error("Mismatched corroboration response.");
    if (result.status === "unavailable") throw new Error("Corroboration index unavailable.");
    return result;
  })();
  try { return await Promise.race([task, deadline]); } finally { clearTimeout(timer); }
}

function purgeRecords(records, now = Date.now()) {
  return records.filter(record => {
    const age = now - Date.parse(record.createdAt);
    return Number.isFinite(age) && age >= 0 && age <= 30 * 86400000;
  }).slice(-500);
}
async function purgeLocalHistory() {
  const { scanLogs = [], extractionFailures = [], lastScan } = await storageGet(["scanLogs", "extractionFailures", "lastScan"]);
  const age = Date.now() - Date.parse(lastScan?.createdAt);
  await storageSet({ scanLogs: purgeRecords(scanLogs), extractionFailures: purgeRecords(extractionFailures),
    lastScan: lastScan && Number.isFinite(age) && age >= 0 && age <= 86400000 ? lastScan : null });
}
purgeLocalHistory().catch(() => {});
const derivedOnly = value => JSON.parse(JSON.stringify(value, (key, item) => key === "evidence" ? undefined : item));

async function scan(options = {}) {
  await purgeLocalHistory();
  const settings = { ...DEFAULTS, ...(await storageGet(Object.keys(DEFAULTS))), ...options };
  const tab = await activeTab();
  const started = performance.now();
  await ensureContentScript(tab.id);
  const extracted = await chrome.tabs.sendMessage(tab.id, { type: "CG_EXTRACT" });
  if (!extracted?.ok) throw new Error("The listing could not be extracted.");

  const page = validatePageSignal(extracted.page);
  if (page.extractionStatus !== "reliable") {
    const { extractionFailures = [] } = await storageGet(["extractionFailures"]);
    await storageSet({ lastScan: null, extractionFailures: [...extractionFailures, {
      createdAt: new Date().toISOString(), id: page.scanId, scenarioId: options.scenarioId || page.scanId,
      groupId: options.groupId || null, split: options.split || null,
      domain: page.domain, siteType: page.siteType, pageStatus: page.pageStatus,
      extractionStatusCode: page.extractionStatusCode, rootSource: page.rootSource,
      extractionLatencyMs: page.extractionLatencyMs,
      extractionStatus: page.extractionStatus, extractionStrategy: page.extractionStrategy,
      selectedContainer: page.selectedContainer, missingFields: page.missingFields,
      fallbackReason: page.fallbackReason
    }].slice(-500) });
    const hint = page.fallbackReason === "verification-required"
      ? " Complete the site's verification in your browser, then scan the loaded job listing."
      : page.fallbackReason === "description-not-ready"
        ? " Open a job and wait for its description to load, then try again." : "";
    throw new Error("Unable to reliably identify the job advertisement content." + hint);
  }
  const scoringStarted = performance.now();
  const baselines = scoreAll(page);
  const localScoringLatencyMs = Number((performance.now() - scoringStarted).toFixed(2));
  const selected = baselines[settings.mode] || baselines.multiSignal;
  let finalResult = selected;
  let escalation = { attempted: false, status: "not-required" };
  const fullWorkflowEnabled = settings.forceEscalation || (settings.autoEscalate && settings.mode === "multiSignal");
  const shouldEscalate = (settings.forceEscalation && settings.evaluationOverride === true) || (fullWorkflowEnabled && ["uncertain", "elevated"].includes(baselines.multiSignal.tier));

  if (shouldEscalate) {
    const notification = chrome.runtime.sendMessage?.({ type: "CG_LOCAL_RESULT", record: {
      page: { pageStatus: page.pageStatus }, displayedResult: selected,
      escalation: { attempted: true, status: "pending" }, interfaceCondition: settings.showReasons ? "explanation" : "score-only",
      totalLatencyMs: Number((performance.now() - started).toFixed(2))
    } });
    notification?.catch?.(() => {});
    escalation = { attempted: true, status: "pending" };
    try {
      const backend = await backendVerify(page, baselines.multiSignal, settings.backendUrl);
      finalResult = combineBackend(baselines.multiSignal, backend);
      escalation = { attempted: true, status: "completed", backendLatencyMs: backend.latencyMs, corroborationIndexVersion: backend.corroborationIndexVersion, runId: backend.runId, duplicateSourceCount: backend.duplicateSourceCount };
    } catch (error) {
      escalation = { attempted: true, status: "unavailable", error: error.message === "Corroboration timeout." ? "TIMEOUT" : "CORROBORATION_UNAVAILABLE" };
    }
  }

  const fullWorkflow = fullWorkflowEnabled
    ? finalResult.model === "full-workflow" ? finalResult : { ...baselines.multiSignal, model: "full-workflow", backend: null }
    : null;
  if (fullWorkflowEnabled) finalResult = fullWorkflow;

  const scanRecord = {
    id: page.scanId || crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    page: {
      url: (() => { const url = new URL(page.url); url.search = ""; url.hash = ""; return url.href; })(),
      domain: page.domain,
      title: page.title,
      pageStatus: page.pageStatus,
      schemaVersion: page.schemaVersion, rootSource: page.rootSource,
      selectorConfidence: page.selectorConfidence, extractionStatusCode: page.extractionStatusCode,
      truncationFlags: page.truncationFlags, fallbackFlags: page.fallbackFlags,
      ExtractionSufficiency: page.ExtractionSufficiency,
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
        emailProviders: (page.emailProvider || []).length,
        contactCues: page.contactCues.length
      }
    },
    baselines: derivedOnly(baselines),
    fullWorkflow: derivedOnly(fullWorkflow),
    selectedMode: settings.mode,
    interfaceCondition: settings.showReasons ? "explanation" : "score-only",
    displayedResult: derivedOnly(finalResult),
    escalation,
    localScoringLatencyMs,
    totalLatencyMs: Number((performance.now() - started).toFixed(2)),
    evaluationOverride: settings.evaluationOverride === true,
    scenarioId: options.scenarioId || page.scanId, groupId: options.groupId || null,
    split: options.split || null, overlapCategory: options.overlapCategory || null,
    configId: baselines.multiSignal.configId,
    groundTruth: null,
    participantResponse: null
  };

  const { scanLogs = [] } = await storageGet(["scanLogs"]);
  const nextLogs = purgeRecords([...scanLogs, scanRecord]);
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
