import { canonicalScenarioUrl } from "./scan-statistics.js";
const LABELS = new Set(["low","uncertain","elevated","reference-insufficient"]);
export function updateReferenceRationale(existing, value, now = new Date().toISOString()) {
  if (typeof value !== "string" || value.trim().length > 2000) throw new Error("Reason must be text of at most 2000 characters.");
  const rationale = value.trim();
  return { rationale, rationaleRecordedAt: rationale === (existing?.rationale || "")
    ? existing?.rationaleRecordedAt || null : now };
}
export function validateTestCases(cases) {
  if(!Array.isArray(cases))throw new Error("Test cases must be a list.");
  const ids=new Set();
  for(const item of cases){
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(item.scenarioId||""))throw new Error("Use a case ID such as CG-001 (letters, numbers, hyphens or underscores).");
    if(ids.has(item.scenarioId))throw new Error(`Duplicate case ID: ${item.scenarioId}`);
    ids.add(item.scenarioId);
    const url=new URL(item.url);
    if(!/^https?:$/.test(url.protocol))throw new Error("Test page must use HTTP or HTTPS.");
    if(item.groundTruth && !LABELS.has(item.groundTruth))throw new Error("Invalid human answer.");
    if(item.split && !["development","validation","test"].includes(item.split))throw new Error("Invalid split.");
    if(item.overlapCategory && !["DIRECT","RELATED","LOWER-OVERLAP"].includes(item.overlapCategory))throw new Error("Invalid overlap category.");
    if(item.rationale != null && (typeof item.rationale !== "string" || item.rationale.length > 2000))throw new Error("Invalid reference reason.");
    for(const key of ["annotatorId","annotationProtocolVersion"]){
      if(item[key] != null && (typeof item[key] !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(item[key])))throw new Error(`Invalid ${key}.`);
    }
  }
  return cases;
}
export class TestCaseIdentificationError extends Error {
  constructor(message) { super(message); this.name = "TestCaseIdentificationError"; }
}
// Match known platform listing IDs, not search/tracking parameters. Unknown
// sites retain the strict URL contract (including identifying query fields).
function casePageKey(value) {
  const url = new URL(canonicalScenarioUrl(value));
  const host = url.hostname.toLowerCase();
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    const id = url.pathname.match(/^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/)?.[1]
      || (/^\/jobs(?:\/|$)/.test(url.pathname) ? url.searchParams.get("currentJobId") : null);
    if (/^\d+$/.test(id || "")) return `linkedin-job:${id}`;
  }
  if (/^(?:[a-z0-9-]+\.)?indeed\.(?:com|co\.uk|com\.au|ca|de|fr|co\.in)$/.test(host)
      && /^\/(?:viewjob|rc\/clk|pagead\/clk|jobs)\/?$/.test(url.pathname)) {
    const id = url.searchParams.get("jk") || url.searchParams.get("vjk");
    if (/^[a-zA-Z0-9]+$/.test(id || "")) return `${host}:indeed-job:${id}`;
  }
  return url.href;
}
export function matchTestCase(cases,url,requestedId) {
  validateTestCases(cases);
  const key=casePageKey(url);
  requestedId = requestedId?.trim();
  if(requestedId){
    const item=cases.find(c=>c.scenarioId===requestedId);
    if(item && casePageKey(item.url)!==key)throw new TestCaseIdentificationError("The selected case ID belongs to a different page. Open the page URL registered for this case in the dashboard, then scan that tab.");
    if(!item && cases.length)throw new TestCaseIdentificationError("The selected case ID is not registered. Copy the exact Case ID from the dashboard (capitalisation matters).");
    return item||null;
  }
  const matches=cases.filter(c=>casePageKey(c.url)===key);
  if(matches.length>1)throw new TestCaseIdentificationError("Several test cases use this URL. Enter the correct case ID before scanning.");
  return matches[0]||null;
}
export function joinTestReferences(records,cases,attempts=records) {
  validateTestCases(cases);
  const index=new Map(cases.map(c=>[c.scenarioId,c]));
  const firstPrediction=new Map();
  for(const row of attempts){
    const time=Date.parse(row.startedAt||row.createdAt);
    if(row.scenarioId && Number.isFinite(time))firstPrediction.set(row.scenarioId,Math.min(firstPrediction.get(row.scenarioId)??Infinity,time));
  }
  return records.map(record=>{
    if(record.failureCode==="CASE_MISMATCH")return {...record,groundTruth:null,referenceJoinStatus:"page-mismatch"};
    const item=index.get(record.scenarioId);
    if(!item)return {...record,referenceJoinStatus:"unregistered"};
    if(record.groupId && item.groupId && record.groupId!==item.groupId)throw new Error(`Group mismatch: ${item.scenarioId}`);
    if(record.split && item.split && record.split!==item.split)throw new Error(`Split mismatch: ${item.scenarioId}`);
    for(const key of ["overlapCategory","annotatorId","annotationProtocolVersion"]){
      if(record[key] && item[key] && record[key]!==item[key])throw new Error(`${key} mismatch: ${item.scenarioId}`);
    }
    if(record.groundTruth && item.groundTruth && record.groundTruth!==item.groundTruth)throw new Error(`Human answer conflict: ${item.scenarioId}`);
    const labelled=!!item.groundTruth;
    const firstTime=Math.min(firstPrediction.get(record.scenarioId)??Infinity,Date.parse(item.firstPredictionAt)||Infinity);
    return {...record,groupId:item.groupId||record.groupId||null,split:item.split||record.split||null,
      overlapCategory:item.overlapCategory||record.overlapCategory||null,
      annotatorId:item.annotatorId||record.annotatorId||null,annotationProtocolVersion:item.annotationProtocolVersion||record.annotationProtocolVersion||null,
      groundTruth:item.groundTruth||record.groundTruth||null,referenceJoinStatus:labelled?"matched":"missing-label",
      reference:labelled?{source:"researcher-manual",labelledAt:item.labelledAt,
        rationale:item.rationale||null,rationaleRecordedAt:item.rationaleRecordedAt||null,
        rationaleRecordedBeforePrediction:!!item.rationale && Number.isFinite(firstTime)&&Number.isFinite(Date.parse(item.rationaleRecordedAt))&&Date.parse(item.rationaleRecordedAt)<=firstTime,
        recordedBeforePrediction:Number.isFinite(firstTime)&&Number.isFinite(Date.parse(item.labelledAt))&&Date.parse(item.labelledAt)<=firstTime,
        note:"Single researcher judgement; independent annotation reliability is not established."}:null};
  });
}
