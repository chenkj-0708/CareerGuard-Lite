import { scoreAll } from "./lib/scoring.js";
import { CONFIG_ID } from "./lib/risk-rules.js";
import { canonicalScenarioUrl, scenarioIdForUrl } from "./lib/scan-statistics.js";
import { matchTestCase, TestCaseIdentificationError } from "./lib/test-cases.js";
import { validatePageSignal, PageSignalValidationError } from "./lib/page-signal.js";

const DEFAULTS = {
  mode: "multiSignal",
  showReasons: true
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

const TIMING_READ_TIMEOUT_MS = 5000;
const WARMUP_RUNS = 2;
const MEASURED_RUNS = 10;

async function readListing(tabId, attempt, timing) {
  const read = async () => {
    // The live content script reads a fresh snapshot on every request. A new
    // document has no receiver, so only that first read needs injection.
    const extract = () => chrome.tabs.sendMessage(tabId, { type: "CG_EXTRACT_CURRENT" });
    attempt.stage = "extraction";
    const existing = await extract().catch(error => {
      if (/Receiving end does not exist/i.test(error.message)) return undefined;
      throw error;
    });
    if (existing !== undefined || timing?.expired) return existing;
    attempt.stage = "injection";
    await ensureContentScript(tabId);
    if (timing?.expired) return;
    attempt.stage = "extraction";
    return extract();
  };
  if (!timing) return read();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timing.expired = true;
      reject(Object.assign(new Error(), { failureCode: "TIMING_READ_TIMEOUT" }));
    }, TIMING_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
function purgeRecords(records, now = Date.now()) {
  return records.filter(record => {
    const age = now - Date.parse(record.createdAt);
    return Number.isFinite(age) && age >= 0 && age <= 30 * 86400000;
  }).slice(-500);
}
async function purgeLocalHistory() {
  const { scanLogs = [], extractionFailures = [], lastScan } = await storageGet(["scanLogs", "extractionFailures", "lastScan"]);
  const now = Date.now();
  const logs = purgeRecords(scanLogs, now), failures = purgeRecords(extractionFailures, now);
  const age = now - Date.parse(lastScan?.createdAt);
  const update = {};
  if (logs.length !== scanLogs.length) update.scanLogs = logs;
  if (failures.length !== extractionFailures.length) update.extractionFailures = failures;
  if (lastScan && (!Number.isFinite(age) || age < 0 || age > 86400000)) update.lastScan = null;
  if (Object.keys(update).length) await storageSet(update);
}
// Each append also enforces retention for its own stream.
const initialHistoryCleanup = purgeLocalHistory().catch(() => {});
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
  CASE_MISMATCH: "Test case identification failed. Check the registered page URL and case ID in the evaluation dashboard.",
  TIMING_PAGE_CHANGED: "The active listing changed. Keep the same page and tab open for the full timing batch.",
  TIMING_READ_TIMEOUT: "The browser did not return listing content within five seconds."
};
const STAGE_FAILURE = { setup: "SETUP_FAILED", tab: "TAB_ACCESS_FAILED", injection: "INJECTION_FAILED",
  extraction: "EXTRACTION_FAILED", validation: "INVALID_PAGE_SIGNAL", scoring: "SCORING_FAILED", persistence: "SAVE_FAILED" };
let failureWrites = Promise.resolve();
async function scan(options = {}, timing = null) {
  options = options || {};
  const attempt = { id: crypto.randomUUID(), scenarioId: options.scenarioId || null, startedAt: new Date().toISOString(), started: performance.now(), stage: "setup", page: null };
  if (timing) attempt.testCase = timing.testCase;
  try { return await performScan(options, attempt, timing); }
  catch (error) {
    const code = Object.hasOwn(FAILURE_REASONS, error?.failureCode) ? error.failureCode : STAGE_FAILURE[attempt.stage] || "SYSTEM_ERROR";
    const page = attempt.page;
    const validationError=error instanceof PageSignalValidationError;
    const reason = FAILURE_REASONS[code] + (validationError || error instanceof TestCaseIdentificationError ? " " + error.message : "");
    const failure = {
      id: attempt.id, attemptId: attempt.id, createdAt: new Date().toISOString(), startedAt: attempt.startedAt,
      scenarioId: attempt.scenarioId, scenarioIdentityVersion: options.scenarioId || attempt.testCase ? "manifest-v1" : "page-url-v1", groupId: attempt.testCase?.groupId || options.groupId || null,
      timingPhase: options.timingPhase === "warmup" ? "warmup" : "measured",
      ...timingMetadata(timing),
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
      await storageSet({ ...(timing ? {} : { lastScan: null }), extractionFailures: purgeRecords([...extractionFailures, failure]) });
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

function timingMetadata(timing) {
  return timing ? {
    timingBatchId: timing.batchId,
    timingRun: timing.run,
    extensionVersion: chrome.runtime.getManifest().version
  } : {};
}

function assertTimingPage(tab, timing) {
  if (tab?.id !== timing.tabId || !/^https?:/i.test(tab?.url || "") ||
      canonicalScenarioUrl(tab.url) !== timing.url) {
    throw Object.assign(new Error(), { failureCode: "TIMING_PAGE_CHANGED" });
  }
}

async function performScan(options, attempt, timing) {
  await initialHistoryCleanup;
  const { testCases = [], rq1HeldOutAccessAt, ...storedSettings } = await storageGet([
    ...Object.keys(DEFAULTS), "testCases", "rq1HeldOutAccessAt"
  ]);
  const settings = { ...DEFAULTS, ...storedSettings, ...options };
  attempt.stage = "tab";
  let tab;
  if (timing) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    assertTimingPage(tab, timing);
  } else {
    tab = await activeTab(attempt);
  }
  let testCase;
  try { testCase = matchTestCase(testCases,tab.url,options.scenarioId); }
  catch (error) {
    if (error instanceof TestCaseIdentificationError) throw Object.assign(error,{failureCode:"CASE_MISMATCH"});
    throw Object.assign(new Error("Test case registry is invalid"),{failureCode:"CASE_MISMATCH"});
  }
  if(testCase){
    attempt.scenarioId=testCase.scenarioId;
    options={...options,scenarioId:testCase.scenarioId,groupId:testCase.groupId||null,split:testCase.split||null};
    // Only identities go to prediction; the separately stored human answer is joined on export.
    attempt.testCase=testCase;
  }
  const started = attempt.started;
  attempt.stage = "injection";
  const extracted = await readListing(tab.id, attempt, timing);
  if (!extracted?.ok) throw new Error("The listing could not be extracted.");

  attempt.stage = "validation";
  const page = validatePageSignal(extracted.page);
  attempt.page = page;
  if (timing) assertTimingPage({ id: tab.id, url: page.url }, timing);
  if (page.extractionStatus !== "reliable") {
    attempt.stage = "extraction";
    throw Object.assign(new Error(FAILURE_REASONS.UNRELIABLE_EXTRACTION), { failureCode: "UNRELIABLE_EXTRACTION" });
  }
  attempt.stage = "scoring";
  // Persist the earliest exposure separately from bounded scan history so a retry
  // or history purge cannot turn a late reference into a prediction-blind one.
  const needsFirstPrediction = testCase && !testCase.firstPredictionAt;
  const needsHeldOutAccess = options.split === "test" && !rq1HeldOutAccessAt;
  if (needsFirstPrediction || needsHeldOutAccess) {
    const referenceState = await storageGet(["testCases", "rq1HeldOutAccessAt"]);
    const referenceUpdate = {};
    if (needsFirstPrediction) {
      const referenceCases = referenceState.testCases || [];
      const current = referenceCases.find(item => item.scenarioId === testCase.scenarioId);
      if (current && !current.firstPredictionAt) {
        referenceUpdate.testCases = referenceCases.map(item => item === current
          ? { ...item, firstPredictionAt: attempt.startedAt } : item);
      }
    }
    if (needsHeldOutAccess && !referenceState.rq1HeldOutAccessAt) {
      referenceUpdate.rq1HeldOutAccessAt = attempt.startedAt;
    }
    if (Object.keys(referenceUpdate).length) await storageSet(referenceUpdate);
  }
  const scoringStarted = performance.now();
  const baselines = scoreAll(page);
  const localScoringLatencyMs = Number((performance.now() - scoringStarted).toFixed(2));
  const localEndToEndLatencyMs = Number((performance.now() - started).toFixed(2));
  const selected = baselines[settings.mode] || baselines.multiSignal;
  if (timing) {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    assertTimingPage(currentTab, timing);
  }

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
    selectedMode: settings.mode,
    interfaceCondition: settings.showReasons ? "explanation" : "score-only",
    displayedResult: derivedOnly(selected),
    localScoringLatencyMs,
    localEndToEndLatencyMs,
    ...timingMetadata(timing),
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
  await storageSet(timing ? { scanLogs: nextLogs } : {
    lastScan: scanRecord, scanLogs: nextLogs,
    ...Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, settings[key]]))
  });
  return scanRecord;
}

async function measureSpeed(caseId, reportProgress, isConnected) {
  const tab = await activeTab({});
  const { testCases = [] } = await storageGet(["testCases"]);
  const testCase = matchTestCase(testCases, tab.url, caseId);
  if (!testCase) throw new Error("Register this listing in the dashboard before measuring speed.");
  const batchId = crypto.randomUUID();
  const url = canonicalScenarioUrl(tab.url);
  const summary = { batchId, measured: 0, succeeded: 0, warmupFailures: 0, stopped: null };
  for (let run = 1; isConnected() && run <= WARMUP_RUNS + MEASURED_RUNS; run++) {
    const warmup = run <= WARMUP_RUNS;
    reportProgress({ run, total: WARMUP_RUNS + MEASURED_RUNS });
    if (!isConnected()) break;
    if (!warmup) summary.measured++;
    try {
      await scan({ scenarioId: testCase.scenarioId, mode: "multiSignal",
        timingPhase: warmup ? "warmup" : "measured" },
        { batchId, run, url, tabId: tab.id, testCase });
      if (!warmup) summary.succeeded++;
    } catch (error) {
      if (warmup) summary.warmupFailures++;
      if (error.failureCode === "TIMING_PAGE_CHANGED" || !error.failureRecorded) {
        summary.stopped = error.message;
        break;
      }
    }
  }
  return summary;
}

chrome.runtime.onInstalled.addListener(async () => {
  await configureSidePanel();
  const current = await storageGet(Object.keys(DEFAULTS));
  await storageSet(Object.fromEntries(Object.entries(DEFAULTS).filter(([key]) => current[key] === undefined)));
});

let timingInProgress = false;
let activeScans = 0;
const SCAN_BUSY = "Wait for the current scan or timing batch to finish.";

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "careerguard-speed") return;
  let connected = true;
  port.onDisconnect.addListener(() => { connected = false; });
  const send = response => {
    if (!connected) return;
    try { port.postMessage(response); }
    catch { connected = false; }
  };
  port.onMessage.addListener(async message => {
    if (message.type !== "start") return;
    if (timingInProgress || activeScans) {
      send({ type: "error", error: SCAN_BUSY });
      return;
    }
    timingInProgress = true;
    try {
      send({ type: "ready" });
      const summary = await measureSpeed(message.caseId,
        progress => send({ type: "progress", ...progress }),
        () => connected);
      send({ type: "complete", summary });
    } catch (error) {
      send({ type: "error", error: error.message });
    } finally {
      timingInProgress = false;
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "CG_SCAN") return;
  if (timingInProgress) {
    sendResponse({ ok: false, error: SCAN_BUSY });
    return;
  }
  activeScans++;
  scan(message.options).then(record => ({ ok: true, record }), error => ({ ok: false, error: error.message })).then(response => {
    activeScans--;
    sendResponse(response);
  });
  return true;
});
