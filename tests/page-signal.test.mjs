import assert from "node:assert/strict";
import {validatePageSignal,PageSignalValidationError} from "../lib/page-signal.js";
const good={schemaVersion:1,scanId:"scan-123",capturedAt:"2026-11-05T00:00:00.000Z",domain:"example.com",siteType:"Generic",rootSource:"job-description",selectorConfidence:"high",extractionStatusCode:"OK",truncationFlags:{visibleText:false,companyText:false,links:false,applicationLinks:false},fallbackFlags:{title:false,companyText:false},extractionQuality:1,ExtractionSufficiency:100,pageStatus:"scoreable",extractionStatus:"reliable",extractionStrategy:"job-description",selectedContainer:".job-description",missingFields:[],fallbackReason:null,extractionLatencyMs:5,url:"https://example.com/job",protocol:"https:",title:"Engineer",companyText:"Example",visibleText:"Normal engineering responsibilities and requirements. ".repeat(8),links:[],externalLinks:[],applicationLinks:[],emailProvider:[],contactCues:[]};
assert.equal(validatePageSignal(good),good);
assert.equal(validatePageSignal({...good,companyText:"",missingFields:["companyText"]}).companyText,"");
assert.equal(validatePageSignal({...good,title:"",fallbackFlags:{...good.fallbackFlags,title:true}}).title,"");
const unavailable={...good,pageStatus:"unsupported",extractionStatus:"unavailable",rootSource:"none",selectorConfidence:"none",extractionStatusCode:"NO_SINGLE_LISTING",extractionStrategy:"none",selectedContainer:null,extractionQuality:0,ExtractionSufficiency:0,fallbackReason:"no-reliable-single-listing-container"};
assert.equal(validatePageSignal(unavailable),unavailable);
let checked=0;
const rejects=(page,field)=>{
  assert.throws(()=>validatePageSignal(page),error=>error instanceof PageSignalValidationError && (!field||error.validationField===field));checked++;
};
for(const key of Object.keys(good)){const page=structuredClone(good);delete page[key];rejects(page,key);}
for(const [field,value] of [
  ["capturedAt","yesterday"],["capturedAt",null],["capturedAt","2026-02-31T00:00:00Z"],["scanId",""],["siteType","Anything"],
  ["truncationFlags",{}],["truncationFlags",{...good.truncationFlags,visibleText:"false"}],
  ["fallbackFlags",[]],["fallbackFlags",{...good.fallbackFlags,extra:true}],
  ["externalLinks",{}],["links",[null]],["links",["javascript:alert(1)"]],
  ["applicationLinks",["https://user:password@example.com/job"]],["applicationLinks",Array(21).fill("https://example.com")],
  ["links",["https://example.com","https://example.com"]],["emailProvider",["person@gmail.com"]],
  ["contactCues",["unknown"]],["extractionLatencyMs",-1],["extractionLatencyMs",NaN],
  ["extractionQuality",Infinity],["extractionQuality",1.1],["title"," "],["visibleText","short"],
  ["visibleText","x".repeat(30001)],["companyText","x".repeat(501)],
  ["url","PRIVATE invalid text"],["url","https://user:password@example.com/job"],
  ["pageStatus","unsupported"],["extractionStatus","unavailable"],["extractionStatusCode","NO_SINGLE_LISTING"],
  ["ExtractionSufficiency",99],["protocol","http:"],["missingFields",["description"]]
])rejects({...good,[field]:value});
for(const field of ["emails","document_body","raw_page"])rejects({...good,[field]:"PRIVATE"},field);
rejects({...unavailable,extractionStatusCode:"OK"},"pageStatus");
rejects({...unavailable,extractionQuality:.5,ExtractionSufficiency:50},"pageStatus");
rejects(null,"PageSignal");rejects([],"PageSignal");
console.log(`${checked} malformed PageSignal cases rejected; valid and missing-company cases accepted`);
