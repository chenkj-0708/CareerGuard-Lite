const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));

function render(record) {
  const result = record.displayedResult;
  const reasons = explanationHtml(record, result);
  const backend = backendHtml(record, result);
  elements.result.innerHTML = `
    <h2>CareerGuard risk result</h2>
    <div><span class="score ${result.tier}">${result.score}</span> / 100 · <span class="tier ${result.tier}">${result.tier} concern</span></div>
    <small>Content reading completeness: ${Number.isFinite(result.ExtractionSufficiency) ? result.ExtractionSufficiency+"%" : "unknown"} (not prediction accuracy) · ${Number.isFinite(record.totalLatencyMs) ? record.totalLatencyMs+" ms" : "timing not recorded"}</small>
    <details class="technical-details"><summary>Technical details</summary><p>Distance from risk-tier boundary: ${Number.isFinite(result.TierBoundaryDistance) ? result.TierBoundaryDistance+"%" : "unknown"}. A smaller value means the score is closer to a tier boundary. This is not confidence or accuracy.</p></details>
    <h3>Local evidence</h3>${reasons}<h3>Duplicate listing context</h3>${backend}
    <h3>Recommended action</h3><p>${result.tier === "low" ? "Verify the employer independently before sharing sensitive information." : "Do not make payment. Verify the employer through an independent official channel before continuing."}</p>`;
  elements.result.hidden = false;
}

function backendHtml(record, result) {
  const status = record.escalation?.status;
  if (status === "pending") return '<p class="backend-status">Lookup in progress. The local result is ready to use.</p>';
  if (status === "unavailable") return '<p class="warning backend-status">Backend unavailable. The local result is retained; duplicate listing context could not be checked.</p>';
  if (status === "not-required") return '<p class="backend-status">Lookup was not requested for this scan.</p>';
  if (status === "completed") {
    const context = result.backend?.contextReasons || [];
    return '<p class="success backend-status">Lookup completed. Context adds no points and does not change the risk tier.</p>' +
      (context.length ? context.map(reason => `<p>${escapeHtml(reason.message)}</p>`).join("") : '<p>The configured index returned no duplicate context meeting the display criteria. This does not establish uniqueness or safety.</p>');
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
    return `<p class="explanation">No major warning signals were detected in the visible job text and page information.</p>`;
  }
  return `<p class="explanation">The available evidence is limited or close to the decision threshold.</p>`;
}

async function scan() {
  elements.scan.disabled = true;
  elements.status.textContent = "Reading and assessing this page…";
  elements.result.hidden = true;
  const options = { mode: "multiSignal", showReasons: true, autoEscalate: true };
  const caseId=elements.caseId.value.trim();
  if(caseId)options.scenarioId=caseId;
  let response;
  try { response = await chrome.runtime.sendMessage({ type: "CG_SCAN", options }); }
  catch (error) { response = { ok: false, error: error.message }; }
  finally { elements.scan.disabled = false; }
  if (!response?.ok) {
    elements.status.textContent = response?.error || "The page could not be scanned.";
    return;
  }
  elements.status.textContent = response.record.scenarioId ? `Case ${response.record.scenarioId}: ${response.record.page.pageStatus}.` : "Local scan completed.";
  render(response.record);
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value || "");
  return node.innerHTML;
}

elements.scan.addEventListener("click", scan);
elements.dashboard.addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener(message => {
  if (message.type === "CG_LOCAL_RESULT" && elements.scan.disabled) {
    render(message.record);
    elements.status.textContent = "Local result ready; backend lookup in progress.";
  }
});
