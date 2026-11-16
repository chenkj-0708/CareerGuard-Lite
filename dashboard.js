import { scanStatistics } from "./lib/scan-statistics.js";
import { validateTestCases, updateReferenceRationale } from "./lib/test-cases.js";
import { dashboardMetrics, METRIC_EXCLUSIONS } from "./lib/dashboard-metrics.js";
import { BACKEND_URL, checkBackendHealth } from "./lib/backend-client.js";
import { defaultResearchContract, validateResearchContract, sealResearchContract, heldOutAccessTime, buildResearchExport } from "./lib/research-protocol.js";
const ids = ["backendUrl", "health", "healthStatus", "summary", "metricsNote", "scanSummary", "records", "exportJson", "exportCsv", "clear", "caseForm", "testId", "testUrl", "testLabel", "testRationale", "testGroup", "testSplit", "testOverlap", "testRefreshReference", "caseStatus", "testCases", "newCase", "researchForm", "researchFields", "researchAnnotator", "researchRubric", "researchTie", "researchMinGroups", "researchMinClass", "researchPairs", "researchPrecision", "researchConformance", "researchLeakage", "researchTaxonomy", "researchEvidence", "saveResearch", "sealResearch", "reviseResearch", "researchStatus", "researchReadiness"];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let logs = [];
let extractionFailures = [];
let testCases = [];
let analysisContract = defaultResearchContract();
let researchExport = null;

const researchInputs = { annotatorId:"researchAnnotator", annotationProtocolVersion:"researchRubric", validationTieBreak:"researchTie", lowerOverlapMinGroups:"researchMinGroups", lowerOverlapClassMinGroups:"researchMinClass", unresolvedCrossSplitPairs:"researchPairs", precisionJustified:"researchPrecision", conformancePassed:"researchConformance", leakageAuditPassed:"researchLeakage", overlapTaxonomySealed:"researchTaxonomy", evidenceNotes:"researchEvidence" };
function renderResearchForm() {
  for(const [key,id] of Object.entries(researchInputs)) {
    if(el[id].type === "checkbox")el[id].checked=analysisContract[key]===true;
    else el[id].value=analysisContract[key]??"";
  }
  el.researchFields.disabled=analysisContract.sealedBeforeHeldOut;
  el.saveResearch.disabled=analysisContract.sealedBeforeHeldOut;
  el.sealResearch.disabled=analysisContract.sealedBeforeHeldOut;
  el.reviseResearch.disabled=!analysisContract.sealedBeforeHeldOut;
  el.researchStatus.textContent=analysisContract.sealedBeforeHeldOut?`Sealed at ${analysisContract.sealedAt}. Export the JSON to retain this protocol snapshot.`:"Unsealed draft. Complete real evidence before sealing; old test access cannot be reset by clearing history.";
}
function readResearchForm() {
  const draft=defaultResearchContract();
  for(const [key,id] of Object.entries(researchInputs)) {
    draft[key]=el[id].type==="checkbox"?el[id].checked:el[id].type==="number"?(el[id].value===""?null:Number(el[id].value)):el[id].value.trim()||null;
  }
  draft.evidenceNotes=el.researchEvidence.value.trim();
  return validateResearchContract(draft);
}

function scoreCell(result, primary = false) {
  const tiers = { low: "Low", uncertain: "Uncertain", elevated: "Elevated" };
  return `<td${primary ? ' class="selected-score"' : ""}>${Number.isFinite(result?.score) ? result.score : "—"} · ${tiers[result?.tier] || "Unknown"}${primary ? " ✓" : ""}</td>`;
}

function backendStatus(record) {
  const labels = { "not-required": "Not requested", pending: "Pending", completed: "Completed", unavailable: "Unavailable" };
  return labels[record.escalation?.status] || "Unknown";
}

function render() {
  el.testCases.innerHTML=testCases.length?`<table><thead><tr><th>Case ID</th><th>Page</th><th>Your answer</th><th>Reason</th><th>Group ID</th><th>Split</th><th>Overlap</th><th>Reference protocol</th><th>Actions</th></tr></thead><tbody>${testCases.map(item=>`<tr><td>${escapeHtml(item.scenarioId)}</td><td>${escapeHtml(item.url)}</td><td>${escapeHtml(item.groundTruth||"Not labelled")}</td><td>${escapeHtml(item.rationale||"Not recorded")}</td><td>${escapeHtml(item.groupId||"—")}</td><td>${escapeHtml(item.split||"Not assigned")}</td><td>${escapeHtml(item.overlapCategory||"Not assigned")}</td><td>${escapeHtml(item.annotatorId||"Missing annotator")} / ${escapeHtml(item.annotationProtocolVersion||"Missing rubric")}</td><td><button type="button" data-edit-case="${escapeHtml(item.scenarioId)}">Edit</button> <button type="button" class="danger" data-delete-case="${escapeHtml(item.scenarioId)}">Delete</button></td></tr>`).join("")}</tbody></table>`:"<p>No test pages registered.</p>";
  const readiness=researchExport?.researchReadiness;
  el.researchReadiness.textContent=readiness?`RQ1 export: ${readiness.status}. ${readiness.protocolIssues.join(" ")} ${Object.keys(readiness.caseIssues).length} cases have missing or incompatible reference metadata. ${Object.entries(readiness.caseIssues).slice(0,5).map(([id,fields])=>`${id}: ${fields.join(", ")}`).join("; ")}`:"No research export prepared.";
  const stats = scanStatistics(logs, extractionFailures);
  const duration = value => value === null ? "—" : `${value.toFixed(1)} ms`;
  el.scanSummary.innerHTML = `<div class="performance-grid">
    <article><span>Scan success</span><strong>${stats.scenario_success_rate === null ? "—" : (stats.scenario_success_rate*100).toFixed(1)+"%"}</strong><small>${stats.successful_scenarios} successful · ${stats.failed_scenarios} failed</small></article>
    <article><span>Typical successful scan</span><strong>${duration(stats.timing.success.median_ms)}</strong><small>p95 ${duration(stats.timing.success.p95_ms)}</small></article>
    <article><span>Page cases</span><strong>${stats.independent_scenarios}</strong><small>${stats.scan_attempts} measured scans · ${stats.repeated_attempts} repeats</small></article>
    </div><details class="help"><summary>Timing & counting details</summary><p>${stats.independent_scenarios} distinct page cases. Failed scans: typical ${duration(stats.timing.failure.median_ms)}, p95 ${duration(stats.timing.failure.p95_ms)}. ${stats.successful_attempts} successful attempts; ${stats.failed_attempts} failed attempts.</p><p>Each case's first measured scan determines success; retries do not replace failures. Timing uses one median per case. Forced tests and marked warm-ups are excluded. ${stats.excluded.unidentified} records have no case ID and are excluded. Figures cover retained history; different URLs may still contain duplicate adverts.</p></details>`;
  const definitions = [["textOnly","Text-only"],["metadataOnly","Metadata-only"],["multiSignal","Multi-signal"]];
  const metrics = dashboardMetrics(logs, extractionFailures);
  el.summary.innerHTML = definitions.map(([key,label]) => {
    const metric = metrics.models[key];
    return `<article class="card"><span>${label}</span><span class="metric-definition">Human-reference agreement (descriptive)</span><strong>${metric.agreement === null ? "—" : `${(metric.agreement*100).toFixed(1)}%`}</strong><small>${metric.count} included cases · ${metrics.excluded_cases} excluded cases</small></article>`;
  }).join("");
  const reasons = Object.entries(metrics.excluded).map(([key,count]) => `${METRIC_EXCLUSIONS[key]}: ${count}`).join("; ");
  el.metricsNote.textContent = `All three methods use the same eligible cases and each case's first retained measured attempt. ${metrics.skipped.repeats} repeat records are not counted again. Skipped records: ${metrics.skipped.forced} forced/synthetic, ${metrics.skipped.warmup} warm-ups, ${metrics.skipped.unidentified} without a case ID, and ${metrics.skipped.invalid_time} without a valid timestamp. ${reasons ? "Exclusions: "+reasons+". " : ""}This is not a formal RQ1 verdict or a measure of real-world fraud detection accuracy.`;
  const backendCounts = logs.reduce((counts, record) => {
    const status = backendStatus(record);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  el.summary.innerHTML += `<article class="card"><span>Backend status</span><strong>${backendCounts.Completed || 0} completed</strong><small>${backendCounts.Unavailable || 0} unavailable · ${backendCounts.Pending || 0} pending · ${backendCounts["Not requested"] || 0} not requested · ${backendCounts.Unknown || 0} unknown</small></article>`;
  el.records.innerHTML = [...logs].reverse().map((record) => {
    const counts = record.page.signalCounts;
    const signalSummary = counts
      ? `${counts.visibleTextCharacters} chars / ${counts.applicationLinks} apply / ${(counts.emailProviders ?? counts.emails ?? 0) + counts.contactCues} contact`
      : "legacy record";
    return `<tr>
      <td>${new Date(record.createdAt).toLocaleString()}</td><td class="case-id">${escapeHtml(record.scenarioId||"No case ID")}</td><td>${escapeHtml(record.page.title || record.page.domain)}</td>
      ${scoreCell(record.baselines?.textOnly)}
      ${scoreCell(record.baselines?.metadataOnly)}
      ${scoreCell(record.baselines?.multiSignal, true)}
      <td>${backendStatus(record)}</td><td>${signalSummary}</td><td>${record.groundTruth || "—"}</td><td>${record.totalLatencyMs} ms</td></tr>`;
  }).join("") || `<tr><td colspan="10" class="muted">No scans recorded yet.</td></tr>`;
}

function escapeHtml(value) { const node=document.createElement("span");node.textContent=String(value||"");return node.innerHTML; }
function download(filename, content, type) { const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);chrome.downloads.download({url,filename,saveAs:true},()=>setTimeout(()=>URL.revokeObjectURL(url),1000)); }
function csvCell(value) { const text=String(value??"");return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text; }

async function load() {
  const stored=await chrome.storage.local.get(["scanLogs","extractionFailures","testCases","analysisContract","rq1HeldOutAccessAt"]);
  researchExport=await buildResearchExport(stored);testCases=validateTestCases(stored.testCases||[]);logs=researchExport.records;extractionFailures=researchExport.extractionFailures;analysisContract=researchExport.analysisContract;
  el.backendUrl.value=BACKEND_URL;render();
}
el.researchForm.addEventListener("submit",async event=>{
  event.preventDefault();
  try {
    if(analysisContract.sealedBeforeHeldOut)throw new Error("Revise the sealed protocol as an unsealed draft first.");
    const draft={...readResearchForm(),savedAt:new Date().toISOString()};
    await chrome.storage.local.set({analysisContract:draft});await load();renderResearchForm();
  }catch(error){el.researchStatus.textContent=error.message;}
});
el.sealResearch.addEventListener("click",async()=>{
  try {
    if(!el.researchForm.reportValidity())return;
    const stored=await chrome.storage.local.get(["testCases","scanLogs","extractionFailures","rq1HeldOutAccessAt"]);
    const access=heldOutAccessTime(stored.testCases||[],[...(stored.scanLogs||[]),...(stored.extractionFailures||[])],stored.rq1HeldOutAccessAt);
    const sealed=await sealResearchContract(readResearchForm(),access);
    await chrome.storage.local.set({analysisContract:sealed,...(access?{rq1HeldOutAccessAt:access}:{})});await load();renderResearchForm();
  }catch(error){el.researchStatus.textContent=error.message;}
});
el.reviseResearch.addEventListener("click",async()=>{
  try {
    const {sealedAt,sealDigest,...draft}=analysisContract;
    await chrome.storage.local.set({analysisContract:{...draft,sealedBeforeHeldOut:false,savedAt:new Date().toISOString()}});await load();renderResearchForm();
  }catch(error){el.researchStatus.textContent=error.message;}
});
el.caseForm.addEventListener("submit",async event=>{
  event.preventDefault();
  try{
    const scenarioId=el.testId.value.trim(),existing=testCases.find(c=>c.scenarioId===scenarioId);
    const item={...existing,scenarioId,url:el.testUrl.value.trim(),groundTruth:el.testLabel.value||null,groupId:el.testGroup.value.trim()||null,split:el.testSplit.value||null,overlapCategory:el.testOverlap.value||null};
    if(existing && existing.url!==item.url)throw new Error("This ID already belongs to a page. Use a new ID for a different page.");
    if(existing && (existing.firstPredictionAt || [...logs,...extractionFailures].some(r=>r.scenarioId===scenarioId)) && ["groupId","split","overlapCategory"].some(key=>(existing[key]||null)!==(item[key]||null)))throw new Error("This case already has scans. Group, split and overlap category must remain fixed.");
    Object.assign(item,updateReferenceRationale(existing,el.testRationale.value));
    const newReference=!!item.groundTruth && (!existing || existing.groundTruth!==item.groundTruth || el.testRefreshReference.checked);
    if(newReference){
      const saved=await chrome.storage.local.get(["analysisContract"]);const protocol={...defaultResearchContract(),...saved.analysisContract};
      if(!protocol.annotatorId||!protocol.annotationProtocolVersion)throw new Error("Save the annotator ID and annotation protocol version in the research protocol before recording an answer.");
      item.labelledAt=new Date().toISOString();item.annotatorId=protocol.annotatorId;item.annotationProtocolVersion=protocol.annotationProtocolVersion;
    }else if(!item.groundTruth){item.labelledAt=null;item.annotatorId=null;item.annotationProtocolVersion=null;}
    const next=[...testCases.filter(c=>c.scenarioId!==scenarioId),item];validateTestCases(next);
    const prior=await chrome.storage.local.get(["rq1HeldOutAccessAt"]);
    const access=heldOutAccessTime(next,[...logs,...extractionFailures],prior.rq1HeldOutAccessAt);
    await chrome.storage.local.set({testCases:next,...(access?{rq1HeldOutAccessAt:access}:{})});await load();el.testRefreshReference.checked=false;el.caseStatus.textContent=`Saved ${scenarioId}. Open the registered page and scan. Late labels and missing legacy metadata are marked in the export.`;
  }catch(error){el.caseStatus.textContent=error.message;}
});
function resetCaseForm() { el.caseForm.reset(); el.testId.readOnly=false; }
el.newCase.addEventListener("click",()=>{resetCaseForm();el.caseStatus.textContent="Ready to register a new test page.";});
el.testCases.addEventListener("click",async event=>{
  const button=event.target.closest("button");if(!button)return;
  const id=button.dataset.editCase||button.dataset.deleteCase;
  const item=testCases.find(c=>c.scenarioId===id);if(!item)return;
  if(button.dataset.deleteCase){
    if(!confirm(`Delete ${id}, its reference answer, and all its local successful/failed scan records? This cannot be undone. Export anything you need to keep first.`))return;
    try {
      const stored=await chrome.storage.local.get(["testCases","scanLogs","extractionFailures","lastScan"]);
      const update={testCases:(stored.testCases||[]).filter(c=>c.scenarioId!==id),scanLogs:(stored.scanLogs||[]).filter(r=>r.scenarioId!==id),extractionFailures:(stored.extractionFailures||[]).filter(r=>r.scenarioId!==id)};
      if(stored.lastScan?.scenarioId===id)update.lastScan=null;
      await chrome.storage.local.set(update);
      if(el.testId.value===id)resetCaseForm();
      await load();el.caseStatus.textContent=`Deleted ${id} and its local research records.`;
    } catch { el.caseStatus.textContent="Deletion failed. Reload and check the retained records before retrying."; }
    return;
  }
  el.testId.value=item.scenarioId;el.testId.readOnly=true;el.testUrl.value=item.url;el.testLabel.value=item.groundTruth||"";el.testRationale.value=item.rationale||"";el.testGroup.value=item.groupId||"";el.testSplit.value=item.split||"";el.testOverlap.value=item.overlapCategory||"";el.testRefreshReference.checked=false;
  el.caseStatus.textContent=`Editing ${id}. Use New / cancel edit to register another case.`;
});
el.health.addEventListener("click",async()=>{
  el.health.disabled=true;el.healthStatus.textContent="Service: checking · Index: checking";
  try {
    const result=await checkBackendHealth();
    const service={connected:"connected",timeout:"timed out (2 seconds)",unavailable:"unavailable or invalid response"};
    const index={available:"available",unavailable:"not configured",unknown:"unknown"};
    el.healthStatus.textContent=`Service: ${service[result.service]} · Index: ${index[result.index]}`;
  } finally { el.health.disabled=false; }
});
el.exportJson.addEventListener("click",async()=>{
  try {await load();download("careerguard-evaluation.json",JSON.stringify({...researchExport,rq2Summary:scanStatistics(logs,extractionFailures)},null,2),"application/json");}
  catch(error){el.caseStatus.textContent=`Cannot export research data: ${error.message}`;}
});
el.exportCsv.addEventListener("click",()=>{const header=["id","created_at","url","page_status","selected_mode","text_score","text_tier","metadata_score","metadata_tier","multi_score","multi_tier","full_score","full_tier","ground_truth","interface_condition","participant_decision","actionability","decision_time_ms","local_scoring_latency_ms","total_latency_ms","escalation_status","scenario_id","group_id","split","overlap_category","config_id","extraction_status_code","root_source","text_evidence","metadata_evidence","annotator_id","annotation_protocol_version","reference_labelled_at","reference_before_prediction","reference_rationale","rationale_recorded_at","rationale_before_prediction"];const rows=logs.map(r=>[r.id,r.createdAt,r.page.url,r.page.pageStatus,r.selectedMode,r.baselines.textOnly.score,r.baselines.textOnly.tier,r.baselines.metadataOnly.score,r.baselines.metadataOnly.tier,r.baselines.multiSignal.score,r.baselines.multiSignal.tier,r.fullWorkflow?.score,r.fullWorkflow?.tier,r.groundTruth,r.interfaceCondition,r.participantResponse?.decision,r.participantResponse?.actionability,r.participantResponse?.decisionTimeMs,r.localScoringLatencyMs,r.totalLatencyMs,r.escalation.status,r.scenarioId,r.groupId,r.split,r.overlapCategory,r.configId,r.page.extractionStatusCode,r.page.rootSource,r.baselines.textOnly.evidenceSum,r.baselines.metadataOnly.evidenceSum,r.annotatorId,r.annotationProtocolVersion,r.reference?.labelledAt,r.reference?.recordedBeforePrediction,r.reference?.rationale,r.reference?.rationaleRecordedAt,r.reference?.rationaleRecordedBeforePrediction]);download("careerguard-evaluation.csv",[header,...rows].map(row=>row.map(csvCell).join(",")).join("\n"),"text/csv");});
el.clear.addEventListener("click",async()=>{if(!confirm("Clear all local scan history, including successful scans, failures and the latest result? Registered cases and reference answers will be kept."))return;await chrome.storage.local.set({scanLogs:[],extractionFailures:[],lastScan:null});await load();});
async function safeLoad(){
  try {await load();el.exportJson.disabled=false;el.exportCsv.disabled=false;}
  catch(error){el.caseStatus.textContent=`Cannot pair research data: ${error.message}`;el.exportJson.disabled=true;el.exportCsv.disabled=true;}
}
safeLoad().then(renderResearchForm);
chrome.storage.onChanged?.addListener((_changes,area)=>{if(area === "local")safeLoad();});

// Deep links open the relevant workspace without exposing every form at once.
function revealSection() {
  const id = location.hash.slice(1);
  const section = document.getElementById(id);
  if (section?.matches("details.disclosure")) section.open = true;
  document.querySelectorAll("nav a").forEach(link => {
    const active = link.hash === (location.hash || "#overview");
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", revealSection);
document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener("click", () => {
  const section = document.getElementById(link.hash.slice(1));
  if (section?.matches("details.disclosure")) section.open = true;
}));
revealSection();
