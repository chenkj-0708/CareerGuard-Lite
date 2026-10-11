const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));

function render(record) {
  const result = record.displayedResult;
  const reasons = explanationHtml(record, result);
  const backend = record.escalation.status === "completed"
    ? `<p class="success">Backend verification completed.</p>`
    : record.escalation.status === "unavailable" ? `<p class="warning">Backend unavailable; local result is shown.</p>` : "";
  elements.result.innerHTML = `
    <h2>CareerGuard risk result</h2>
    <div><span class="score ${result.tier}">${result.score}</span> / 100 · <span class="tier ${result.tier}">${result.tier} concern</span></div>
    <small>Confidence cue ${result.confidence}% · ${record.totalLatencyMs} ms</small>${reasons}${backend}`;
  elements.result.hidden = false;
}

function explanationHtml(record, result) {
  if (record.interfaceCondition !== "explanation") return "";
  if (result.reasons?.length) {
    return `<ul>${result.reasons.map((reason) => `<li>${escapeHtml(reason.message)}</li>`).join("")}</ul>`;
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
  const response = await chrome.runtime.sendMessage({ type: "CG_SCAN", options });
  elements.scan.disabled = false;
  if (!response?.ok) {
    elements.status.textContent = response?.error || "The page could not be scanned.";
    return;
  }
  elements.status.textContent = `Captured as ${response.record.page.pageStatus}.`;
  render(response.record);
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value || "");
  return node.innerHTML;
}

elements.scan.addEventListener("click", scan);
elements.dashboard.addEventListener("click", () => chrome.runtime.openOptionsPage());
