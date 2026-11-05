import { canonicalScenarioUrl } from "./scan-statistics.js";
const LABELS = new Set(["low","uncertain","elevated","reference-insufficient"]);
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
  }
  return cases;
}
export function matchTestCase(cases,url,requestedId) {
  validateTestCases(cases);
  const key=canonicalScenarioUrl(url);
  if(requestedId){
    const item=cases.find(c=>c.scenarioId===requestedId);
    if(item && canonicalScenarioUrl(item.url)!==key)throw new Error("The selected case ID belongs to a different page. Open its registered URL.");
    if(!item && cases.length)throw new Error("The selected case ID is not registered.");
    return item||null;
  }
  const matches=cases.filter(c=>canonicalScenarioUrl(c.url)===key);
  if(matches.length>1)throw new Error("Several test cases use this URL. Enter the correct case ID before scanning.");
  return matches[0]||null;
}
export function joinTestReferences(records,cases) {
  validateTestCases(cases);
  const index=new Map(cases.map(c=>[c.scenarioId,c]));
  return records.map(record=>{
    if(record.failureCode==="CASE_MISMATCH")return {...record,groundTruth:null,referenceJoinStatus:"page-mismatch"};
    const item=index.get(record.scenarioId);
    if(!item)return {...record,referenceJoinStatus:"unregistered"};
    if(record.groupId && item.groupId && record.groupId!==item.groupId)throw new Error(`Group mismatch: ${item.scenarioId}`);
    if(record.split && item.split && record.split!==item.split)throw new Error(`Split mismatch: ${item.scenarioId}`);
    if(record.groundTruth && item.groundTruth && record.groundTruth!==item.groundTruth)throw new Error(`Human answer conflict: ${item.scenarioId}`);
    const labelled=!!item.groundTruth;
    return {...record,groupId:item.groupId||record.groupId||null,split:item.split||record.split||null,
      groundTruth:item.groundTruth||record.groundTruth||null,referenceJoinStatus:labelled?"matched":"missing-label",
      reference:labelled?{source:"researcher-manual",labelledAt:item.labelledAt,
        recordedBeforePrediction:Number.isFinite(Date.parse(item.labelledAt))&&Date.parse(item.labelledAt)<=Date.parse(record.startedAt||record.createdAt),
        note:"Single researcher judgement; independent annotation reliability is not established."}:null};
  });
}
