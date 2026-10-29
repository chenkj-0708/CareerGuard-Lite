import assert from "node:assert/strict";
let listener, page, stored={}, requests=[], mode="success", notifications=[];
globalThis.chrome={ sidePanel:{async setPanelBehavior(){}},
 tabs:{async query(){return [{id:1,url:"https://example.com/job"}]},async sendMessage(){return {ok:true,page}}},
 scripting:{async executeScript(){}},storage:{local:{async get(){return stored},async set(value){Object.assign(stored,value)}}},
 runtime:{onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn}},async sendMessage(message){notifications.push(message)}} };
globalThis.fetch=async(url,options)=>{
 if(mode==="offline")throw new Error("offline");
 if(mode==="timeout")return new Promise(()=>{});
 if(url.endsWith("/health"))return {ok:true,async json(){return {token:"a".repeat(43)}}};
 const body=JSON.parse(options.body);requests.push(body);
 return {ok:true,async json(){return mode==="corrupted"?{score:0}:{schemaVersion:1,requestId:body.requestId,status:"completed",corroborationIndexVersion:"test-index",runId:"test-run",duplicateSourceCount:0,contextReasons:[],latencyMs:1}}};
};
const {BACKEND_TIMEOUT_MS}=await import("../background.js");
assert.equal(BACKEND_TIMEOUT_MS,2000);
const scan=options=>new Promise(resolve=>listener({type:"CG_SCAN",options:{mode:"multiSignal",autoEscalate:true,...options}}, {},resolve));
const base={schemaVersion:1,scanId:"scan-1234567890123",capturedAt:new Date().toISOString(),rootSource:"site-specific",selectorConfidence:"high",extractionStatusCode:"OK",truncationFlags:{visibleText:false,companyText:false,links:false,applicationLinks:false},fallbackFlags:{title:false,companyText:false},extractionQuality:1,ExtractionSufficiency:100,domain:"example.com",siteType:"Generic",pageStatus:"scoreable",extractionStatus:"reliable",visibleText:"Registration fee. Bank account. Urgent hiring. WhatsApp. Guaranteed income. No interview. ".repeat(8),url:"https://example.com/job?tracking=private#fragment",protocol:"https:",title:"Engineer",companyText:"Example",emailProvider:["gmail.com"],links:[],externalLinks:[],applicationLinks:["https://bit.ly/x"],contactCues:["whatsapp"]};
page={...base,extractionStatus:"unavailable",pageStatus:"unsupported",rootSource:"none",selectorConfidence:"none",extractionStatusCode:"NO_SINGLE_LISTING"};
assert.equal((await scan()).ok,false);assert.equal(requests.length,0);assert.equal(stored.lastScan,null);
page={...base};
for(mode of ["success","offline","corrupted","timeout"]){
 const start=performance.now(); const response=await scan();assert.equal(response.ok,true);
 assert.equal(response.record.displayedResult.score,response.record.baselines.multiSignal.score);
 assert.equal(response.record.displayedResult.tier,response.record.baselines.multiSignal.tier);
 assert.equal(response.record.escalation.status,mode==="success"?"completed":"unavailable");
 assert.equal(response.record.page.url,"https://example.com/job");
 if(mode==="timeout"){assert.ok(performance.now()-start>=1900);assert.ok(performance.now()-start<2600);}
}
assert.deepEqual(Object.keys(requests[0]).sort(),["requestId","schemaVersion","scenarioOrScanId","excerptHash","hashContractVersion","capabilityToken"].sort());
assert.match(requests[0].excerptHash,/^[a-f0-9]{64}$/);
assert.ok(!JSON.stringify(requests).includes("example.com"));
assert.ok(!JSON.stringify(stored).includes(page.visibleText));
mode="success";page={...base,visibleText:"Normal engineering work. ".repeat(20),emailProvider:[],contactCues:[],applicationLinks:[]};
const before=requests.length;const low=await scan({forceEscalation:true});assert.equal(low.record.escalation.attempted,false);assert.equal(requests.length,before);
console.log("hash-only workflow, 2-second deadline, safe failure and eligibility tests passed");
