export const PAGE_SIGNAL_VERSION = 1;
export const ROOT_SOURCES = Object.freeze(["site-specific", "schema.org-jobposting", "jobposting", "job-description", "bounded-generic", "none"]);
export const STATUS_CODES = Object.freeze(["OK", "AMBIGUOUS_LISTINGS", "SITE_VERIFICATION_REQUIRED", "DESCRIPTION_NOT_READY", "NO_SINGLE_LISTING", "INSUFFICIENT_VISIBLE_TEXT"]);
export class PageSignalValidationError extends Error {
  constructor(code,field) {
    const reasons={MISSING_FIELD:"Missing required field",INVALID_FORMAT:"Incorrect field format",OUT_OF_RANGE:"Field value is outside its allowed range",INCONSISTENT_STATE:"Fields contradict each other",PROHIBITED_FIELD:"Prohibited raw data field"};
    super(`${reasons[code]}: ${field}.`);
    this.name="PageSignalValidationError";this.validationCode=code;this.validationField=field;
  }
}
const fail=(code,field)=>{throw new PageSignalValidationError(code,field);};
const object=value=>!!value && typeof value==="object" && !Array.isArray(value);
const text=(value,min=0,max=Infinity)=>typeof value==="string" && Array.from(value.trim()).length>=min && Array.from(value).length<=max;
const finite=(value,min,max)=>typeof value==="number" && Number.isFinite(value) && value>=min && value<=max;
function httpUrl(value,field) {
  if(typeof value!=="string")fail("INVALID_FORMAT",field);
  let url;try{url=new URL(value);}catch{fail("INVALID_FORMAT",field);}
  if(!/^https?:$/.test(url.protocol)||url.username||url.password)fail("INVALID_FORMAT",field);
  return url;
}
function strings(value,field,max,predicate=()=>true) {
  if(!Array.isArray(value)||value.length>max||new Set(value).size!==value.length||value.some(item=>typeof item!=="string"||!predicate(item)))fail("INVALID_FORMAT",field);
}
export function validatePageSignal(page) {
  if(!object(page))fail("INVALID_FORMAT","PageSignal");
  const required=["schemaVersion","scanId","capturedAt","domain","siteType","rootSource","selectorConfidence","extractionStatusCode","truncationFlags","fallbackFlags","extractionQuality","ExtractionSufficiency","pageStatus","extractionStatus","extractionStrategy","selectedContainer","missingFields","fallbackReason","extractionLatencyMs"];
  for(const key of required)if(!Object.hasOwn(page,key))fail("MISSING_FIELD",key);
  for(const key of ["emails","document_body","raw_page"])if(Object.hasOwn(page,key))fail("PROHIBITED_FIELD",key);
  if(page.schemaVersion!==1)fail("INVALID_FORMAT","schemaVersion");
  if(!text(page.scanId,1,80))fail("INVALID_FORMAT","scanId");
  if(typeof page.capturedAt!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(page.capturedAt)||!Number.isFinite(Date.parse(page.capturedAt)))fail("INVALID_FORMAT","capturedAt");
  if(new Date(page.capturedAt).toISOString().slice(0,19)!==page.capturedAt.slice(0,19))fail("INVALID_FORMAT","capturedAt");
  if(!text(page.domain,1,253)||! /^[a-z0-9.:[\]-]+$/i.test(page.domain))fail("INVALID_FORMAT","domain");
  for(const [key,values] of [["siteType",["JobStreet","Indeed","LinkedIn","Generic"]],["rootSource",ROOT_SOURCES],["selectorConfidence",["high","bounded","none"]],["extractionStatusCode",STATUS_CODES],["pageStatus",["scoreable","unsupported","extraction-limited"]],["extractionStatus",["reliable","unavailable"]],["extractionStrategy",ROOT_SOURCES]])if(!values.includes(page[key]))fail("INVALID_FORMAT",key);
  for(const [key,flags] of [["truncationFlags",["visibleText","companyText","links","applicationLinks"]],["fallbackFlags",["title","companyText"]]]){
    if(!object(page[key])||Object.keys(page[key]).length!==flags.length||flags.some(flag=>typeof page[key][flag]!=="boolean"))fail("INVALID_FORMAT",key);
  }
  if(!finite(page.extractionQuality,0,1))fail("OUT_OF_RANGE","extractionQuality");
  if(!Number.isInteger(page.ExtractionSufficiency)||page.ExtractionSufficiency!==Math.round(100*page.extractionQuality))fail("INCONSISTENT_STATE","ExtractionSufficiency");
  if(!finite(page.extractionLatencyMs,0,Infinity))fail("OUT_OF_RANGE","extractionLatencyMs");
  strings(page.missingFields,"missingFields",2,item=>["description","companyText"].includes(item));
  if(page.pageStatus!=="scoreable"){
    if(page.extractionStatus!=="unavailable"||page.extractionStatusCode==="OK"||page.selectorConfidence!=="none"||page.extractionQuality!==0||page.extractionStrategy!=="none"||page.selectedContainer!==null||!text(page.fallbackReason,1,120))fail("INCONSISTENT_STATE","pageStatus");
    return page;
  }
  if(page.extractionStatus!=="reliable"||page.extractionStatusCode!=="OK"||page.rootSource==="none"||page.selectorConfidence==="none"||page.extractionStrategy!==page.rootSource||!text(page.selectedContainer,1,500)||page.fallbackReason!==null||page.missingFields.includes("description"))fail("INCONSISTENT_STATE","pageStatus");
  for(const key of ["url","protocol","title","companyText","visibleText","links","externalLinks","applicationLinks","emailProvider","contactCues"])if(!Object.hasOwn(page,key))fail("MISSING_FIELD",key);
  if(!text(page.title)||(!page.title.trim() && !page.fallbackFlags.title))fail("INVALID_FORMAT","title");
  if(!text(page.companyText,0,500))fail("OUT_OF_RANGE","companyText");
  if(!text(page.visibleText,150,30000))fail("OUT_OF_RANGE","visibleText");
  if((!page.companyText.trim())!==page.missingFields.includes("companyText"))fail("INCONSISTENT_STATE","missingFields");
  const url=httpUrl(page.url,"url");
  if(page.protocol!==url.protocol||page.domain!==url.hostname.toLowerCase().replace(/^www\./,""))fail("INCONSISTENT_STATE","url");
  for(const [key,max] of [["links",100],["externalLinks",100],["applicationLinks",20]])strings(page[key],key,max,value=>{httpUrl(value,key);return true;});
  strings(page.emailProvider,"emailProvider",20,value=>/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(value));
  strings(page.contactCues,"contactCues",4,value=>["whatsapp","telegram","wechat","signal"].includes(value));
  return page;
}
