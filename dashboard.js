const ids = ["backendUrl", "saveSettings", "health", "healthStatus", "summary", "records", "exportJson", "exportCsv", "clear"];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let logs = [];

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
  const definitions = [["textOnly","Text-only"],["metadataOnly","Metadata-only"],["multiSignal","Multi-signal"],["fullWorkflow","Full workflow"]];
  el.summary.innerHTML = definitions.map(([key,label]) => {
    const metric = metricFor(key);
    return `<article class="card"><span>${label}</span><strong>${metric.accuracy === null ? "—" : `${(metric.accuracy*100).toFixed(1)}%`}</strong><small>${metric.count} labelled records</small></article>`;
  }).join("");
  el.records.innerHTML = [...logs].reverse().map((record) => {
    const counts = record.page.signalCounts;
    const signalSummary = counts
      ? `${counts.visibleTextCharacters} chars / ${counts.applicationLinks} apply / ${counts.emails + counts.contactCues} contact`
      : "legacy record";
    return `<tr>
      <td>${new Date(record.createdAt).toLocaleString()}</td><td>${escapeHtml(record.page.title || record.page.domain)}</td>
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

async function load() { const stored=await chrome.storage.local.get(["scanLogs","backendUrl"]);logs=stored.scanLogs||[];el.backendUrl.value=stored.backendUrl||"http://127.0.0.1:8765";render(); }
el.saveSettings.addEventListener("click",async()=>{await chrome.storage.local.set({backendUrl:el.backendUrl.value.replace(/\/$/,"")});el.healthStatus.textContent="Saved.";});
el.health.addEventListener("click",async()=>{el.healthStatus.textContent="Checking…";try{const response=await fetch(`${el.backendUrl.value.replace(/\/$/,"")}/health`);const data=await response.json();el.healthStatus.textContent=data.ok?"Backend ready.":"Backend returned an error.";}catch{el.healthStatus.textContent="Backend unavailable.";}});
el.exportJson.addEventListener("click",()=>download("careerguard-evaluation.json",JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),records:logs},null,2),"application/json"));
el.exportCsv.addEventListener("click",()=>{const header=["id","created_at","url","page_status","selected_mode","text_score","text_tier","metadata_score","metadata_tier","multi_score","multi_tier","full_score","full_tier","ground_truth","interface_condition","participant_decision","actionability","decision_time_ms","local_scoring_latency_ms","total_latency_ms","escalation_status"];const rows=logs.map(r=>[r.id,r.createdAt,r.page.url,r.page.pageStatus,r.selectedMode,r.baselines.textOnly.score,r.baselines.textOnly.tier,r.baselines.metadataOnly.score,r.baselines.metadataOnly.tier,r.baselines.multiSignal.score,r.baselines.multiSignal.tier,r.fullWorkflow?.score,r.fullWorkflow?.tier,r.groundTruth,r.interfaceCondition,r.participantResponse?.decision,r.participantResponse?.actionability,r.participantResponse?.decisionTimeMs,r.localScoringLatencyMs,r.totalLatencyMs,r.escalation.status]);download("careerguard-evaluation.csv",[header,...rows].map(row=>row.map(csvCell).join(",")).join("\n"),"text/csv");});
el.clear.addEventListener("click",async()=>{if(!confirm("Clear all locally stored evaluation records?"))return;logs=[];await chrome.storage.local.set({scanLogs:[],lastScan:null});render();});
load();
