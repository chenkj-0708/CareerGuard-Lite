const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));

function render(record) {
  const result = record.displayedResult;
  const reasons = explanationHtml(record, result);
  const backend = backendHtml(record, result);
  elements.result.innerHTML = `
    <div class="result-heading"><span class="eyebrow">LISTING CHECK</span><span class="tier ${result.tier}">${result.tier} concern</span></div>
    <div class="score-row"><span class="score ${result.tier}">${result.score}</span><span class="score-caption">/ 100<br>Concern score</span></div>
    <div class="risk-track" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, Number(result.score) || 0))}%" class="${result.tier}"></span></div>
    <p class="advice">${result.tier === "low" ? "Verify the employer before sharing personal details." : "Pause before applying. Never pay to get a job."}</p>
    <p class="result-caveat">Advisory only. A low score does not guarantee safety.</p>
    ${reasons ? `<div class="evidence"><h3>What we noticed</h3>${reasons}</div>` : ""}
    <div class="duplicate-context"><h3>Duplicate listing context</h3>${backend}</div>
    <details class="technical-details"><summary>Scan details</summary><p>Content reading completeness: ${Number.isFinite(result.ExtractionSufficiency) ? result.ExtractionSufficiency+"%" : "unknown"} (not prediction accuracy)</p><p>Distance from risk-tier boundary: ${Number.isFinite(result.TierBoundaryDistance) ? result.TierBoundaryDistance+"%" : "unknown"}. A smaller value means the score is closer to a tier boundary. This is not confidence or accuracy.</p><p>${Number.isFinite(record.totalLatencyMs) ? record.totalLatencyMs+" ms" : "Timing not recorded"}</p><p>Verify the employer through an independent official channel before continuing.</p></details>`;
  elements.result.hidden = false;
}

function backendHtml(record, result) {
  const status = record.escalation?.status;
  if (status === "pending") return '<p class="backend-status">Lookup in progress. Local result ready.</p>';
  if (status === "unavailable") return '<p class="warning backend-status">Backend unavailable. Duplicate context unchecked; local score unchanged.</p>';
  if (status === "not-required") return '<p class="backend-status">Lookup was not requested.</p>';
  if (status === "completed") {
    const context = result.backend?.contextReasons || [];
    return '<p class="success backend-status">Lookup completed. No effect on score.</p>' +
      (context.length ? context.map(reason => `<p>${escapeHtml(reason.message)}</p>`).join("") : '<p>No qualifying matches. This does not establish uniqueness or safety.</p>');
  }
  return '<p class="backend-status">Lookup status unknown.</p>';
}

function explanationHtml(record, result) {
  if (record.interfaceCondition !== "explanation") return "";
  if (result.reasons?.length) {
    const roles = { scored: "Scoring signal", context: "Context (no points)", uncertainty: "Information limitation (no points)" };
    return `<ul>${result.reasons.map((reason) => `<li><strong>${roles[reason.role || "scored"] || "Other information"}:</strong> ${escapeHtml(reason.message)}</li>`).join("")}</ul>`;
  }
  if (result.tier === "low") {
    return `<p class="explanation">No major warning signals found.</p>`;
  }
  return `<p class="explanation">Limited evidence or a borderline score.</p>`;
}

async function scan() {
  elements.scan.disabled = true;
  elements.measureSpeed.disabled = true;
  elements.status.textContent = "Reading and assessing this page…";
  elements.result.hidden = true;
  const options = { mode: "multiSignal", showReasons: true, autoEscalate: true };
  const caseId=elements.caseId.value.trim();
  if(caseId)options.scenarioId=caseId;
  let response;
  try { response = await chrome.runtime.sendMessage({ type: "CG_SCAN", options }); }
  catch (error) { response = { ok: false, error: error.message }; }
  finally { elements.scan.disabled = elements.measureSpeed.disabled = false; }
  if (!response?.ok) {
    elements.status.textContent = response?.error || "The page could not be scanned.";
    return;
  }
  elements.status.textContent = "Scan complete";
  render(response.record);
}

async function measureSpeed() {
  elements.scan.disabled = elements.measureSpeed.disabled = elements.caseId.disabled = true;
  elements.status.textContent = "Measuring speed… Keep this listing open.";
  try {
    const caseId = elements.caseId.value.trim() || undefined;
    const { measured, succeeded, warmupFailures, stopped } = await requestTimingBatch(caseId);
    const counts = `${succeeded}/${measured} measured scans succeeded. ${warmupFailures} warm-up failures.`;
    elements.status.textContent = stopped
      ? `Timing stopped. ${stopped} ${counts}`
      : `Timing complete. ${counts} Results are available in Dashboard → Export JSON.`;
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    elements.scan.disabled = elements.measureSpeed.disabled = elements.caseId.disabled = false;
  }
}

function requestTimingBatch(caseId) {
  const reconnectHint = "Reload CareerGuard Lite in chrome://extensions, then reopen the side panel.";
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connect({ name: "careerguard-speed" });
    } catch {
      reject(new Error(reconnectHint));
      return;
    }
    const startup = setTimeout(() => {
      port.disconnect();
      reject(new Error(`The background worker did not respond. ${reconnectHint}`));
    }, 5000);
    let acknowledged = false;
    port.onDisconnect.addListener(() => {
      clearTimeout(startup);
      // Reading lastError here consumes Chrome's disconnect error.
      const lastError = chrome.runtime.lastError;
      const message = acknowledged
        ? "The timing connection closed. Check the Dashboard export for any scans already saved."
        : `The timing worker is unavailable. ${reconnectHint}`;
      reject(new Error(message, { cause: lastError }));
    });
    port.onMessage.addListener(message => {
      clearTimeout(startup);
      if (message.type === "ready") acknowledged = true;
      if (message.type === "progress") {
        elements.status.textContent = `Measuring speed… Run ${message.run}/${message.total}. Keep this listing open.`;
      }
      if (message.type === "complete" || message.type === "error") {
        if (message.type === "complete") resolve(message.summary);
        else reject(new Error(message.error));
        port.disconnect();
      }
    });
    try {
      port.postMessage({ type: "start", caseId });
    } catch {
      clearTimeout(startup);
      port.disconnect();
      reject(new Error(reconnectHint));
    }
  });
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value || "");
  return node.innerHTML;
}

elements.scan.addEventListener("click", scan);
elements.measureSpeed.addEventListener("click", measureSpeed);
elements.dashboard.addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener(message => {
  if (message.type === "CG_LOCAL_RESULT" && elements.scan.disabled && !elements.caseId.disabled) {
    render(message.record);
    elements.status.textContent = "Local result ready; backend lookup in progress.";
  }
});
