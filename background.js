import { combineBackend, scoreAll } from "./lib/scoring.js";
import { CONFIG_ID } from "./lib/risk-rules.js";
import { scenarioIdForUrl } from "./lib/scan-statistics.js";
import { matchTestCase } from "./lib/test-cases.js";
import { validatePageSignal, PageSignalValidationError } from "./lib/page-signal.js";
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

async function activeTab(attempt) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw Object.assign(new Error("No active browser tab was found."), { failureCode: "NO_ACTIVE_TAB" });
  if (tab.url) attempt.scenarioId = attempt.scenarioId || await scenarioIdForUrl(tab.url);
  if (!/^https?:/i.test(tab.url || "")) {
    throw Object.assign(new Error("This page cannot be scanned. Open a normal public website using HTTP or HTTPS."), { failureCode: "UNSUPPORTED_PAGE" });
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

const FAILURE_REASONS = {
  SETUP_FAILED: "Unable to prepare local scan storage.",
  TAB_ACCESS_FAILED: "Unable to access the active browser tab.",
  NO_ACTIVE_TAB: "No active browser tab was found.",
  UNSUPPORTED_PAGE: "This page cannot be scanned. Open a normal public website using HTTP or HTTPS.",
  INJECTION_FAILED: "Unable to read this page. It may be unavailable or restricted by the browser.",
  EXTRACTION_FAILED: "Unable to read the listing content.",
  INVALID_PAGE_SIGNAL: "The page reader returned incomplete or invalid data.",
  UNRELIABLE_EXTRACTION: "Unable to reliably identify the job advertisement content.",
  SCORING_FAILED: "Unable to assess the extracted listing.",
  SAVE_FAILED: "Unable to save the scan result.",
  SYSTEM_ERROR: "The scan could not be completed because of a system error.",
  CASE_MISMATCH: "Test case identification failed. Check the registered page URL and case ID in the evaluation dashboard."
};
const STAGE_FAILURE = { setup: "SETUP_FAILED", tab: "TAB_ACCESS_FAILED", injection: "INJECTION_FAILED",
  extraction: "EXTRACTION_FAILED", validation: "INVALID_PAGE_SIGNAL", scoring: "SCORING_FAILED", persistence: "SAVE_FAILED" };
let failureWrites = Promise.resolve();
async function scan(options = {}) {
  options = options || {};
  const attempt = { id: crypto.randomUUID(), scenarioId: options.scenarioId || null, startedAt: new Date().toISOString(), started: performance.now(), stage: "setup", page: null };
  try { return await performScan(options, attempt); }
  catch (error) {
    const code = Object.hasOwn(FAILURE_REASONS, error?.failureCode) ? error.failureCode : STAGE_FAILURE[attempt.stage] || "SYSTEM_ERROR";
    const page = attempt.page;
    const validationError=error instanceof PageSignalValidationError;
    const reason = FAILURE_REASONS[code] + (validationError ? " " + error.message : "");
    const failure = {
      id: attempt.id, attemptId: attempt.id, createdAt: new Date().toISOString(), startedAt: attempt.startedAt,
      scenarioId: attempt.scenarioId, scenarioIdentityVersion: options.scenarioId || attempt.testCase ? "manifest-v1" : "page-url-v1", groupId: attempt.testCase?.groupId || options.groupId || null,
      timingPhase: options.timingPhase === "warmup" ? "warmup" : "measured",
      split: attempt.testCase?.split || options.split || null, configId: CONFIG_ID, evaluationOverride: options.evaluationOverride === true,
      failureStage: attempt.stage, failureCode: code, failureReason: reason,
      ...(validationError ? {validationCode:error.validationCode,validationField:error.validationField}:{}),
      totalLatencyMs: Number((performance.now() - attempt.started).toFixed(2)),
      domain: page?.domain || null, siteType: page?.siteType || null, pageStatus: page?.pageStatus || "unavailable",
      extractionStatusCode: page?.extractionStatusCode || null, rootSource: page?.rootSource || null,
      extractionLatencyMs: page?.extractionLatencyMs ?? null, extractionStatus: page?.extractionStatus || "unavailable",
      extractionStrategy: page?.extractionStrategy || null, selectedContainer: page?.selectedContainer || null,
      missingFields: page?.missingFields || [], fallbackReason: page?.fallbackReason || null
    };
    // Serialize failed writes so simultaneous scan failures cannot overwrite each other.
    // Never persist raw exception messages, URLs, page text or stack traces.
    const write = failureWrites.catch(() => {}).then(async () => {
      const { extractionFailures = [] } = await storageGet(["extractionFailures"]);
      await storageSet({ lastScan: null, extractionFailures: purgeRecords([...extractionFailures, failure]) });
    });
    failureWrites = write;
    let recorded = true;
    try { await write; } catch { recorded = false; }
    const hint = page?.fallbackReason === "verification-required"
      ? " Complete the site's verification in your browser, then scan the loaded job listing."
      : page?.fallbackReason === "description-not-ready" ? " Open a job and wait for its description to load, then try again." : "";
    throw Object.assign(new Error(reason + hint + (recorded ? "" : " The failure record could not be saved because local storage is unavailable.")),
      { failureCode: code, failureRecorded: recorded, attemptId: attempt.id });
  }
}

async function performScan(options, attempt) {
  await purgeLocalHistory();
  const settings = { ...DEFAULTS, ...(await storageGet(Object.keys(DEFAULTS))), ...options };
  attempt.stage = "tab";
  const tab = await activeTab(attempt);
  const { testCases = [] } = await storageGet(["testCases"]);
  let testCase;
  try { testCase = matchTestCase(testCases,tab.url,options.scenarioId); }
  catch { throw Object.assign(new Error("Test case mismatch"),{failureCode:"CASE_MISMATCH"}); }
  if(testCase){
    attempt.scenarioId=testCase.scenarioId;
    options={...options,scenarioId:testCase.scenarioId,groupId:testCase.groupId||null,split:testCase.split||null};
    // Only identities go to prediction; the separately stored human answer is joined on export.
    attempt.testCase=testCase;
  }
  const started = attempt.started;
  attempt.stage = "injection";
  await ensureContentScript(tab.id);
  attempt.stage = "extraction";
  const extracted = await chrome.tabs.sendMessage(tab.id, { type: "CG_EXTRACT" });
  if (!extracted?.ok) throw new Error("The listing could not be extracted.");

  attempt.stage = "validation";
  const page = validatePageSignal(extracted.page);
  attempt.page = page;
  if (page.extractionStatus !== "reliable") {
    attempt.stage = "extraction";
    throw Object.assign(new Error(FAILURE_REASONS.UNRELIABLE_EXTRACTION), { failureCode: "UNRELIABLE_EXTRACTION" });
  }
  attempt.stage = "scoring";
  const scoringStarted = performance.now();
  const baselines = scoreAll(page);
  const localScoringLatencyMs = Number((performance.now() - scoringStarted).toFixed(2));
  const selected = baselines[settings.mode] || baselines.multiSignal;
  let finalResult = selected;
  let escalation = { attempted: false, status: "not-required" };
  const fullWorkflowEnabled = settings.forceEscalation || (settings.autoEscalate && settings.mode === "multiSignal");
  const shouldEscalate = (settings.forceEscalation && settings.evaluationOverride === true) || (fullWorkflowEnabled && ["uncertain", "elevated"].includes(baselines.multiSignal.tier));

  if (shouldEscalate) {
    const backendStarted = performance.now();
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
    escalation.clientLatencyMs = Number((performance.now() - backendStarted).toFixed(2));
  }

  const fullWorkflow = fullWorkflowEnabled
    ? finalResult.model === "full-workflow" ? finalResult : { ...baselines.multiSignal, model: "full-workflow", backend: null }
    : null;
  if (fullWorkflowEnabled) finalResult = fullWorkflow;

  const scanRecord = {
    attemptId: attempt.id,
    startedAt: attempt.startedAt,
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
    scenarioId: attempt.scenarioId, scenarioIdentityVersion: options.scenarioId ? "manifest-v1" : "page-url-v1",
    timingPhase: options.timingPhase === "warmup" ? "warmup" : "measured", groupId: options.groupId || null,
    split: options.split || null, overlapCategory: options.overlapCategory || null,
    configId: baselines.multiSignal.configId,
    groundTruth: null,
    participantResponse: null
  };

  attempt.stage = "persistence";
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
