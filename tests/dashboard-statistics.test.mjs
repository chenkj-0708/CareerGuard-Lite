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
    if(!["dashboard.html","dashboard.css","dashboard.js","lib/scan-statistics.js","lib/test-cases.js","lib/dashboard-metrics.js","lib/backend-client.js","lib/risk-rules.js","lib/research-protocol.js"].includes(path))return route.abort();
    route.fulfill({body:fs.readFileSync(new URL(`../${path}`,import.meta.url)),contentType:path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":"text/html"});
  });
  await page.addInitScript(()=>{
    const result={score:5,tier:"low"};
    globalThis.stored={scanLogs:[{id:"a1",attemptId:"a1",scenarioId:"a",createdAt:"2026-11-05T00:00:00Z",totalLatencyMs:100,page:{title:"Engineer",domain:"example.com"},baselines:{textOnly:result,metadataOnly:result,multiSignal:result},escalation:{status:"not-required"}}],extractionFailures:[{id:"b1",attemptId:"b1",scenarioId:"b",createdAt:"2026-11-05T00:00:01Z",totalLatencyMs:800,failureCode:"INJECTION_FAILED"}]};
    globalThis.chrome={storage:{local:{async get(){return structuredClone(globalThis.stored)},async set(value){Object.assign(globalThis.stored,value)}}},downloads:{download(options){fetch(options.url).then(r=>r.text()).then(text=>{globalThis.downloaded=text;});}}};
  });
  await page.goto("https://extension.test/dashboard.html");
  await page.waitForFunction(()=>document.getElementById("scanSummary").textContent.includes("50.0%"));
  assert.equal(await page.locator("#protocol").getAttribute("open"), null);
  assert.equal(await page.locator("#cases").getAttribute("open"), null);
  await page.locator('nav a[href="#cases"]').click();
  assert.equal(await page.locator("#cases").getAttribute("open"), "");
  await page.locator("#cases > summary").click();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({width, height:1000});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}px`);
  }
  await page.locator("#scanSummary summary").click();
  const text=await page.locator("#scanSummary").innerText();
  assert.ok(text.includes("1 successful")&&text.includes("1 failed"));
  assert.ok(text.includes("100.0 ms")&&text.includes("800.0 ms"));
  assert.equal(await page.locator("#backendUrl").getAttribute("readonly"), "");
  assert.equal(await page.locator("#saveSettings").count(), 0);
  assert.ok((await page.locator("#summary").innerText()).includes("Human-reference agreement (descriptive)"));
  assert.ok((await page.locator("#records .selected-score").innerText()).includes("5 · Low ✓"));
  await page.locator("#connection > summary").click();
  let healthMode = "no-index";
  await page.route("http://127.0.0.1:8765/health", async route => {
    if (healthMode === "timeout") return;
    await route.fulfill({ json: healthMode === "legacy" ? { ok:true } : { ok:true, indexAvailable:healthMode === "ready" } });
  });
  for (const [mode, expected] of [["no-index", "Index: not configured"], ["ready", "Index: available"], ["legacy", "Index: unknown"], ["timeout", "timed out"]]) {
    healthMode = mode;
    await page.click("#health");
    await page.waitForFunction(() => !document.getElementById("health").disabled);
    assert.ok((await page.locator("#healthStatus").innerText()).includes(expected));
  }
  page.on("dialog",dialog=>dialog.accept());
  await page.click("#clear");
  await page.waitForFunction(()=>document.getElementById("scanSummary").textContent.includes("0 distinct page cases"));
  assert.deepEqual(await page.evaluate(()=>stored.extractionFailures),[]);
  await page.locator("#protocol > summary").click();
  await page.locator("#cases > summary").click();
  await page.fill("#researchAnnotator","researcher-1");await page.fill("#researchRubric","single-rubric-v1");await page.click("#saveResearch");
  await page.waitForFunction(()=>stored.analysisContract?.annotatorId === "researcher-1");
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
  assert.equal(exported.records[0].annotatorId,"researcher-1");
  assert.equal(exported.records[0].annotationProtocolVersion,"single-rubric-v1");
  assert.equal(exported.analysisContract.annotationMode,"single");
  assert.equal(exported.analysisContract.sealedBeforeHeldOut,false);
  assert.ok(exported.records[0].baselines.textOnly && exported.records[0].baselines.metadataOnly && exported.records[0].baselines.multiSignal);
  assert.equal(await page.evaluate(()=>stored.scanLogs[0].groundTruth),null);
  await page.evaluate(()=>{globalThis.downloaded=null;});await page.click("#exportCsv");
  await page.waitForFunction(()=>typeof globalThis.downloaded==="string"&&downloaded.startsWith("id,"));
  const csv=await page.evaluate(()=>downloaded);
  assert.ok(csv.split("\n")[0].includes("annotator_id,annotation_protocol_version,reference_labelled_at,reference_before_prediction"));
  assert.ok(csv.includes("researcher-1,single-rubric-v1"));
  await page.click('[data-edit-case="CG-001"]');
  assert.equal(await page.locator("#testId").getAttribute("readonly"), "");
  await page.click("#newCase");
  assert.equal(await page.locator("#testId").inputValue(), "");
  assert.equal(await page.locator("#testId").getAttribute("readonly"), null);
  await page.evaluate(() => {
    stored.lastScan = { scenarioId:"CG-001" };
    stored.extractionFailures = [{scenarioId:"CG-001", id:"failed"}, {scenarioId:"other", id:"retained"}];
    stored.scanLogs.push({...stored.scanLogs[0], id:"other", scenarioId:"other"});
  });
  await page.click('[data-delete-case="CG-001"]');
  await page.waitForFunction(() => document.getElementById("caseStatus").textContent.includes("Deleted CG-001"));
  assert.equal(await page.evaluate(() => stored.testCases.length), 0);
  assert.deepEqual(await page.evaluate(() => stored.scanLogs.map(r=>r.scenarioId)), ["other"]);
  assert.deepEqual(await page.evaluate(() => stored.extractionFailures.map(r=>r.scenarioId)), ["other"]);
  assert.equal(await page.evaluate(() => stored.lastScan), null);
  console.log("dashboard success/failure counts, median/p95 presentation and full reset passed");
}finally{await browser.close();}
