import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CG_PLAYWRIGHT||"playwright");
const browser=await chromium.launch({headless:true,channel:"msedge"});
try {
  const page=await browser.newPage();
  await page.route("https://extension.test/**",route=>{
    const path=new URL(route.request().url()).pathname.slice(1);
    if(!["dashboard.html","dashboard.css","dashboard.js","lib/scan-statistics.js","lib/test-cases.js"].includes(path))return route.abort();
    route.fulfill({body:fs.readFileSync(new URL(`../${path}`,import.meta.url)),contentType:path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":"text/html"});
  });
  await page.addInitScript(()=>{
    const result={score:5,tier:"low"};
    globalThis.stored={scanLogs:[{id:"a1",attemptId:"a1",scenarioId:"a",createdAt:"2026-11-05T00:00:00Z",totalLatencyMs:100,page:{title:"Engineer",domain:"example.com"},baselines:{textOnly:result,metadataOnly:result,multiSignal:result},escalation:{status:"not-required"}}],extractionFailures:[{id:"b1",attemptId:"b1",scenarioId:"b",createdAt:"2026-11-05T00:00:01Z",totalLatencyMs:800,failureCode:"INJECTION_FAILED"}]};
    globalThis.chrome={storage:{local:{async get(){return structuredClone(globalThis.stored)},async set(value){Object.assign(globalThis.stored,value)}}},downloads:{download(options){fetch(options.url).then(r=>r.text()).then(text=>{globalThis.downloaded=text;});}}};
  });
  await page.goto("https://extension.test/dashboard.html");
  await page.waitForFunction(()=>document.getElementById("scanSummary").textContent.includes("50.0%"));
  const text=await page.locator("#scanSummary").innerText();
  assert.ok(text.includes("1 successful")&&text.includes("1 failed"));
  assert.ok(text.includes("100.0 ms")&&text.includes("800.0 ms"));
  page.on("dialog",dialog=>dialog.accept());
  await page.click("#clear");
  await page.waitForFunction(()=>document.getElementById("scanSummary").textContent.includes("0 distinct page cases"));
  assert.deepEqual(await page.evaluate(()=>stored.extractionFailures),[]);
  await page.fill("#testId","CG-001");await page.fill("#testUrl","https://example.com/job?jk=1");
  await page.selectOption("#testLabel","low");await page.click("#caseForm button");
  await page.waitForFunction(()=>document.getElementById("caseStatus").textContent.includes("Saved CG-001"));
  await page.evaluate(()=>{
    const result={score:5,tier:"low"};
    stored.scanLogs=[{id:"scan1",scenarioId:"CG-001",startedAt:new Date().toISOString(),createdAt:new Date().toISOString(),page:{title:"Engineer"},baselines:{textOnly:result,metadataOnly:result,multiSignal:result},groundTruth:null,escalation:{status:"not-required"}}];
  });
  await page.click("#caseForm button");await page.waitForFunction(()=>document.getElementById("records").textContent.includes("CG-001"));
  await page.click("#exportJson");await page.waitForFunction(()=>globalThis.downloaded);
  const exported=await page.evaluate(()=>JSON.parse(downloaded));
  assert.equal(exported.records[0].groundTruth,"low");
  assert.equal(exported.records[0].reference.recordedBeforePrediction,true);
  assert.ok(exported.records[0].baselines.textOnly && exported.records[0].baselines.metadataOnly && exported.records[0].baselines.multiSignal);
  assert.equal(await page.evaluate(()=>stored.scanLogs[0].groundTruth),null);
  console.log("dashboard success/failure counts, median/p95 presentation and full reset passed");
}finally{await browser.close();}
