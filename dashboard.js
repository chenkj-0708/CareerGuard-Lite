import { scanStatistics } from "./lib/scan-statistics.js";
import { validateTestCases, joinTestReferences } from "./lib/test-cases.js";
const ids = ["backendUrl", "saveSettings", "health", "healthStatus", "summary", "scanSummary", "records", "exportJson", "exportCsv", "clear", "caseForm", "testId", "testUrl", "testLabel", "testGroup", "testSplit", "caseStatus", "testCases"];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let logs = [];
let extractionFailures = [];
let testCases = [];

const tierIndex = { low: 0, uncertain: 1, elevated: 2 };
const modeLabels = { textOnly: "Text-only", metadataOnly: "Metadata-only", multiSignal: "Multi-signal" };

function scoreCell(record, mode, score) {
  const selected = record.selectedMode === mode;
  return `<td class="${selected ? "selected-score" : ""}">${score}${selected ? " ✓" : ""}</td>`;
}

function metricFor(key) {
  const labelled = logs.filter((record) => record.groundTruth && (key !== "fullWorkflow" || record.fullWorkflow));
  if (!labelled.length) return { accuracy: null, count: 0 };
  const correct = labelled.filter((record) => (key === "fullWorkflow" ? record.fullWorkflow : record.baselines[key]).tier === record.groundTruth).length;
  return { accuracy: correct / labelled.length, count: labelled.length };
}

function render() {
  el.testCases.innerHTML=testCases.length?`<table><thead><tr><th>Case ID</th><th>Page</th><th>Your answer</th><th></th></tr></thead><tbody>${testCases.map(item=>`<tr><td>${escapeHtml(item.scenarioId)}</td><td>${escapeHtml(item.url)}</td><td>${escapeHtml(item.groundTruth||"Not labelled")}</td><td><button type="button" data-edit-case="${escapeHtml(item.scenarioId)}">Edit</button></td></tr>`).join("")}</tbody></table>`:"<p>No test pages registered.</p>";
  const stats = scanStatistics(logs, extractionFailures);
  const duration = value => value === null ? "—" : `${value.toFixed(1)} ms`;
  el.scanSummary.innerHTML = `<p>${stats.independent_scenarios} distinct page cases · ${stats.successful_scenarios} successful · ${stats.failed_scenarios} failed · Success rate: ${stats.scenario_success_rate === null ? "—" : (stats.scenario_success_rate*100).toFixed(1)+"%"}</p>
    <p>${stats.scan_attempts} measured scans: ${stats.successful_attempts} succeeded, ${stats.failed_attempts} failed; ${stats.repeated_attempts} repeat scans.</p>
    <p>Successful scans: typical ${duration(stats.timing.success.median_ms)}, slower cases (p95) ${duration(stats.timing.success.p95_ms)}.<br>Failed scans: typical ${duration(stats.timing.failure.median_ms)}, slower cases (p95) ${duration(stats.timing.failure.p95_ms)}.</p>
    <p>Each case's first measured scan determines success; retries do not replace failures. Timing uses one median per case. Forced tests and marked warm-ups are excluded. ${stats.excluded.unidentified} records have no case ID and are excluded. Figures cover retained history; different URLs may still contain duplicate adverts.</p>`;
  const definitions = [["textOnly","Text-only"],["metadataOnly","Metadata-only"],["multiSignal","Multi-signal"],["fullWorkflow","Full workflow"]];
  el.summary.innerHTML = definitions.map(([key,label]) => {
    const metric = metricFor(key);
    return `<article class="card"><span>${label}</span><strong>${metric.accuracy === null ? "—" : `${(metric.accuracy*100).toFixed(1)}%`}</strong><small>${metric.count} labelled records</small></article>`;
  }).join("");
  el.records.innerHTML = [...logs].reverse().map((record) => {
    const counts = record.page.signalCounts;
    const signalSummary = counts
      ? `${counts.visibleTextCharacters} chars / ${counts.applicationLinks} apply / ${(counts.emailProviders ?? counts.emails ?? 0) + counts.contactCues} contact`
      : "legacy record";
    return `<tr>
      <td>${new Date(record.createdAt).toLocaleString()}</td><td>${escapeHtml(record.scenarioId||"No case ID")}<br>${escapeHtml(record.page.title || record.page.domain)}</td>
      <td><span class="mode-badge">${modeLabels[record.selectedMode] || record.selectedMode || "Unknown"}</span></td>
      ${scoreCell(record, "textOnly", record.baselines.textOnly.score)}
      ${scoreCell(record, "metadataOnly", record.baselines.metadataOnly.score)}
      ${scoreCell(record, "multiSignal", record.baselines.multiSignal.score)}
      <td>${record.fullWorkflow?.score ?? "—"}</td><td>${signalSummary}</td><td>${record.groundTruth || "—"}</td><td>${record.interfaceCondition}</td><td>${record.totalLatencyMs} ms</td></tr>`;
  }).join("") || `<tr><td colspan="11" class="muted">No scans recorded yet.</td></tr>`;
}

function escapeHtml(value) { const node=document.createElement("span");node.textContent=String(value||"");return node.innerHTML; }
function download(filename, content, type) { const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);chrome.downloads.download({url,filename,saveAs:true},()=>setTimeout(()=>URL.revokeObjectURL(url),1000)); }
function csvCell(value) { const text=String(value??"");return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text; }

async function load() { const stored=await chrome.storage.local.get(["scanLogs","backendUrl","extractionFailures","testCases"]);testCases=validateTestCases(stored.testCases||[]);logs=joinTestReferences(stored.scanLogs||[],testCases);extractionFailures=joinTestReferences(stored.extractionFailures||[],testCases);el.backendUrl.value=stored.backendUrl||"http://127.0.0.1:8765";render(); }
el.caseForm.addEventListener("submit",async event=>{
  event.preventDefault();
  try{
    const scenarioId=el.testId.value.trim(),existing=testCases.find(c=>c.scenarioId===scenarioId);
    const item={scenarioId,url:el.testUrl.value.trim(),groundTruth:el.testLabel.value||null,groupId:el.testGroup.value.trim()||null,split:el.testSplit.value||null};
    if(existing && existing.url!==item.url)throw new Error("This ID already belongs to a page. Use a new ID for a different page.");
    if(existing && [...logs,...extractionFailures].some(r=>r.scenarioId===scenarioId) && (existing.groupId!==item.groupId || existing.split!==item.split))throw new Error("This case already has scans. Group and split must remain fixed.");
    item.labelledAt=item.groundTruth ? (existing?.groundTruth===item.groundTruth?existing.labelledAt:new Date().toISOString()):null;
    const next=[...testCases.filter(c=>c.scenarioId!==scenarioId),item];validateTestCases(next);
    await chrome.storage.local.set({testCases:next});await load();el.caseStatus.textContent=`Saved ${scenarioId}. Open the registered page and scan. Late labels are marked in the export.`;
  }catch(error){el.caseStatus.textContent=error.message;}
});
el.testCases.addEventListener("click",event=>{
  const item=testCases.find(c=>c.scenarioId===event.target.dataset.editCase);if(!item)return;
  el.testId.value=item.scenarioId;el.testUrl.value=item.url;el.testLabel.value=item.groundTruth||"";el.testGroup.value=item.groupId||"";el.testSplit.value=item.split||"";
});
el.saveSettings.addEventListener("click",async()=>{await chrome.storage.local.set({backendUrl:el.backendUrl.value.replace(/\/$/,"")});el.healthStatus.textContent="Saved.";});
el.health.addEventListener("click",async()=>{el.healthStatus.textContent="Checking…";try{const response=await fetch(`${el.backendUrl.value.replace(/\/$/,"")}/health`);const data=await response.json();el.healthStatus.textContent=data.ok?"Backend ready.":"Backend returned an error.";}catch{el.healthStatus.textContent="Backend unavailable.";}});
el.exportJson.addEventListener("click",()=>download("careerguard-evaluation.json",JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),records:logs,extractionFailures,testCases,rq2Summary:scanStatistics(logs,extractionFailures)},null,2),"application/json"));
el.exportCsv.addEventListener("click",()=>{const header=["id","created_at","url","page_status","selected_mode","text_score","text_tier","metadata_score","metadata_tier","multi_score","multi_tier","full_score","full_tier","ground_truth","interface_condition","participant_decision","actionability","decision_time_ms","local_scoring_latency_ms","total_latency_ms","escalation_status","scenario_id","group_id","split","overlap_category","config_id","extraction_status_code","root_source","text_evidence","metadata_evidence"];const rows=logs.map(r=>[r.id,r.createdAt,r.page.url,r.page.pageStatus,r.selectedMode,r.baselines.textOnly.score,r.baselines.textOnly.tier,r.baselines.metadataOnly.score,r.baselines.metadataOnly.tier,r.baselines.multiSignal.score,r.baselines.multiSignal.tier,r.fullWorkflow?.score,r.fullWorkflow?.tier,r.groundTruth,r.interfaceCondition,r.participantResponse?.decision,r.participantResponse?.actionability,r.participantResponse?.decisionTimeMs,r.localScoringLatencyMs,r.totalLatencyMs,r.escalation.status,r.scenarioId,r.groupId,r.split,r.overlapCategory,r.configId,r.page.extractionStatusCode,r.page.rootSource,r.baselines.textOnly.evidenceSum,r.baselines.metadataOnly.evidenceSum]);download("careerguard-evaluation.csv",[header,...rows].map(row=>row.map(csvCell).join(",")).join("\n"),"text/csv");});
el.clear.addEventListener("click",async()=>{if(!confirm("Clear all locally stored evaluation records?"))return;logs=[];extractionFailures=[];await chrome.storage.local.set({scanLogs:[],extractionFailures:[],lastScan:null});render();});
async function safeLoad(){
  try {await load();el.exportJson.disabled=false;el.exportCsv.disabled=false;}
  catch(error){el.caseStatus.textContent=`Cannot pair research data: ${error.message}`;el.exportJson.disabled=true;el.exportCsv.disabled=true;}
}
safeLoad();
chrome.storage.onChanged?.addListener((_changes,area)=>{if(area === "local")safeLoad();});
