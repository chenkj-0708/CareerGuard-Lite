import assert from "node:assert/strict";

let listener, stored = {}, failureMode = "none", saveRejected = false;
let backendRequests=0;
globalThis.fetch=async()=>{backendRequests++;throw privateError();};
const privateError = () => new Error("PRIVATE page text https://example.com/?secret=123");
const base = {
  schemaVersion:1, scanId:"scan-1234567890123", capturedAt:new Date().toISOString(),
  rootSource:"site-specific", selectorConfidence:"high", extractionStatusCode:"OK",
  truncationFlags:{visibleText:false,companyText:false,links:false,applicationLinks:false},
  fallbackFlags:{title:false,companyText:false}, extractionQuality:1, ExtractionSufficiency:100,
  domain:"example.com",siteType:"Generic",pageStatus:"scoreable",extractionStatus:"reliable",
  visibleText:"Normal engineering work. ".repeat(20),url:"https://example.com/job",protocol:"https:",
  title:"Engineer",companyText:"Example",emailProvider:[],links:[],externalLinks:[],applicationLinks:[],contactCues:[],
  extractionStrategy:"site-specific",selectedContainer:"#description",missingFields:[],fallbackReason:null,extractionLatencyMs:1
};
globalThis.chrome = {
  sidePanel:{async setPanelBehavior(){}},
  tabs:{async query(){
    if(failureMode==="tab")throw privateError();
    if(failureMode==="no-tab")return [];
    return [{id:1,url:failureMode==="unsupported"?"chrome-error://chromewebdata/":"https://example.com/job"}];
  },async sendMessage(){
    if(failureMode==="message")throw privateError();
    if(failureMode==="reader")return {ok:false,error:privateError().message};
    if(failureMode==="invalid")return {ok:true,page:{schemaVersion:99}};
    if(failureMode==="missing-time"){const page={...base};delete page.capturedAt;return {ok:true,page};}
    if(failureMode==="bad-flags")return {ok:true,page:{...base,truncationFlags:{}}};
    if(failureMode==="bad-link")return {ok:true,page:{...base,links:["PRIVATE https://example.com/?secret=123"]}};
    if(failureMode==="scoring")return {ok:true,page:{...base,externalLinks:{}}};
    if(failureMode==="unreliable")return {ok:true,page:{...base,pageStatus:"unsupported",extractionStatus:"unavailable",rootSource:"none",selectorConfidence:"none",extractionStatusCode:"NO_SINGLE_LISTING",fallbackReason:"no-reliable-single-listing-container",extractionLatencyMs:12,extractionStrategy:"none",selectedContainer:null,extractionQuality:0,ExtractionSufficiency:0}};
    return {ok:true,page:{...base}};
  }},
  scripting:{async executeScript(){if(failureMode==="injection") {await new Promise(resolve=>setTimeout(resolve,20));throw privateError();}}},
  storage:{local:{async get(){if(failureMode==="storage")throw privateError();return structuredClone(stored);},async set(value){
    if(failureMode==="storage")throw privateError();
    if(failureMode==="save" && value.scanLogs?.length && !saveRejected){saveRejected=true;throw privateError();}
    Object.assign(stored,structuredClone(value));
  }}},
  runtime:{onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn}},async sendMessage(){}}
};
await import("../background.js");
await new Promise(resolve=>setTimeout(resolve,0));
const scan = () => new Promise(resolve=>listener({type:"CG_SCAN",options:{scenarioId:"scenario-fixed",groupId:"group-fixed",split:"test",evaluationOverride:true}},{},resolve));
const expected = {tab:"TAB_ACCESS_FAILED","no-tab":"NO_ACTIVE_TAB",unsupported:"UNSUPPORTED_PAGE",injection:"INJECTION_FAILED",message:"EXTRACTION_FAILED",reader:"EXTRACTION_FAILED",invalid:"INVALID_PAGE_SIGNAL","missing-time":"INVALID_PAGE_SIGNAL","bad-flags":"INVALID_PAGE_SIGNAL","bad-link":"INVALID_PAGE_SIGNAL",unreliable:"UNRELIABLE_EXTRACTION",scoring:"INVALID_PAGE_SIGNAL",save:"SAVE_FAILED"};
for(const [mode,code] of Object.entries(expected)) {
  failureMode=mode;stored={lastScan:{createdAt:new Date().toISOString()},extractionFailures:[]};saveRejected=false;
  const result=await scan();
  assert.equal(result.ok,false,mode);
  assert.equal(stored.extractionFailures.length,1,mode);
  const failure=stored.extractionFailures[0];
  assert.equal(failure.failureCode,code,mode);
  assert.ok(failure.failureReason && failure.failureStage && failure.attemptId,mode);
  assert.ok(Number.isFinite(failure.totalLatencyMs) && failure.totalLatencyMs>=0,mode);
  if(mode==="injection")assert.ok(failure.totalLatencyMs>=15);
  assert.equal(failure.scenarioId,"scenario-fixed");assert.equal(failure.groupId,"group-fixed");
  assert.equal(failure.split,"test");assert.equal(failure.evaluationOverride,true);
  assert.ok(Number.isFinite(Date.parse(failure.startedAt)));
  assert.equal(stored.lastScan,null);
  assert.ok(!JSON.stringify(stored).includes("PRIVATE"));
  assert.ok(!JSON.stringify(stored).includes("secret=123"));
  assert.ok(!result.error.includes("PRIVATE"));assert.equal(backendRequests,0);
  assert.ok(!("score" in failure));
  if(code==="INVALID_PAGE_SIGNAL"){
    assert.ok(failure.validationField && failure.validationCode);
    assert.match(result.error,new RegExp(failure.validationField));
    assert.equal(stored.scanLogs?.length||0,0);
  }
}
failureMode="injection";stored={extractionFailures:[]};
await Promise.all([scan(),scan()]);
assert.equal(stored.extractionFailures.length,2);
assert.notEqual(stored.extractionFailures[0].attemptId,stored.extractionFailures[1].attemptId);
failureMode="none";stored={extractionFailures:[]};
assert.equal((await scan()).ok,true);assert.equal(stored.extractionFailures.length,0);
failureMode="storage";
const storageFailure=await scan();assert.equal(storageFailure.ok,false);
assert.match(storageFailure.error,/failure record could not be saved/);
console.log("scan failure stages, timing, privacy, single-record writes and storage-failure reporting passed");
