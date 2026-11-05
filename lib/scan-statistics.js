// A page key retains job-identifying parameters; only known tracking fields are removed.
export function canonicalScenarioUrl(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|ref|referrer|trackingId|tracking|trk|fbclid|gclid|source)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (/^#(?:sol=|utm_|tracking)/i.test(url.hash)) url.hash = "";
  return url.href;
}
export async function scenarioIdForUrl(value) {
  const bytes = new TextEncoder().encode(canonicalScenarioUrl(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "page-v1-" + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
}
const percentile = (values,p) => {
  if (!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b), n=(sorted.length-1)*p, lo=Math.floor(n), hi=Math.ceil(n);
  return Number((sorted[lo]+(sorted[hi]-sorted[lo])*(n-lo)).toFixed(3));
};
function timing(rows, field) {
  const groups=new Map();let missing=0;
  for(const row of rows){
    const value=field(row);
    if(typeof value!=="number" || !Number.isFinite(value) || value<0){missing++;continue;}
    const values=groups.get(row.scenarioId)||[];values.push(value);groups.set(row.scenarioId,values);
  }
  const medians=[...groups.values()].map(values=>percentile(values,.5));
  return {scenarios:medians.length,measured_runs:rows.length-missing,missing_timing_runs:missing,
    median_ms:percentile(medians,.5),p95_ms:percentile(medians,.95)};
}
export function scanStatistics(records=[],failures=[]) {
  const excluded={forced:0,warmup:0,unidentified:0,duplicate_attempt:0};
  const seen=new Set(), rows=[];
  for(const [source,success] of [[records,true],[failures,false]])for(const item of source){
    if(item.evaluationOverride){excluded.forced++;continue;}
    if(item.timingPhase==="warmup"){excluded.warmup++;continue;}
    if(!item.scenarioId){excluded.unidentified++;continue;}
    const attempt=item.attemptId||item.id;
    if(attempt && seen.has(attempt)){excluded.duplicate_attempt++;continue;}
    if(attempt)seen.add(attempt);
    rows.push({...item,success});
  }
  // Earliest measured attempt is fixed per scenario, so retries cannot turn a failure into success.
  rows.sort((a,b)=>(Date.parse(a.startedAt||a.createdAt)||0)-(Date.parse(b.startedAt||b.createdAt)||0) || String(a.attemptId||a.id||"").localeCompare(String(b.attemptId||b.id||"")));
  const groups=new Map();
  for(const row of rows){const list=groups.get(row.scenarioId)||[];list.push(row);groups.set(row.scenarioId,list);}
  const first=[...groups.values()].map(list=>list[0]), succeeded=first.filter(r=>r.success).length;
  const failureCodes={};for(const row of rows.filter(r=>!r.success)){const code=row.failureCode||"LEGACY_FAILURE";failureCodes[code]=(failureCodes[code]||0)+1;}
  return {
    independent_scenarios:first.length,successful_scenarios:succeeded,failed_scenarios:first.length-succeeded,
    scenario_success_rate:first.length?succeeded/first.length:null,
    scan_attempts:rows.length,successful_attempts:rows.filter(r=>r.success).length,failed_attempts:rows.filter(r=>!r.success).length,
    repeated_attempts:rows.length-first.length,mixed_outcome_scenarios:[...groups.values()].filter(list=>list.some(r=>r.success)&&list.some(r=>!r.success)).length,
    excluded,failure_codes:failureCodes,
    timing:{all:timing(rows,r=>r.totalLatencyMs),success:timing(rows.filter(r=>r.success),r=>r.totalLatencyMs),failure:timing(rows.filter(r=>!r.success),r=>r.totalLatencyMs),
      extraction:timing(rows,r=>r.page?.extractionLatencyMs??r.extractionLatencyMs),local:timing(rows.filter(r=>r.success),r=>r.localScoringLatencyMs),
      backend:timing(rows.filter(r=>r.escalation?.attempted),r=>r.escalation.clientLatencyMs)},
    counting_rule:"First measured attempt per scenario determines success; repeated timings are reduced to one median per scenario before median/p95. Forced runs and marked warm-ups excluded. Legacy scenario IDs are not reconstructed."
  };
}
