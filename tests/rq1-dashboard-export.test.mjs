// Functional end-to-end fixture only. None of these declarations are research evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CG_PLAYWRIGHT||"playwright");
const browser=await chromium.launch({headless:true,channel:"msedge"});
try {
  const page=await browser.newPage();
  await page.route("https://extension.test/**",route=>{
    const name=new URL(route.request().url()).pathname.slice(1);
    if(!["dashboard.html","dashboard.css","dashboard.js","lib/scan-statistics.js","lib/test-cases.js","lib/dashboard-metrics.js","lib/backend-client.js","lib/risk-rules.js","lib/research-protocol.js"].includes(name))return route.abort();
    return route.fulfill({body:fs.readFileSync(new URL(`../${name}`,import.meta.url)),contentType:name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"text/html"});
  });
  await page.addInitScript(()=>{
    globalThis.stored={scanLogs:[],extractionFailures:[],testCases:[]};
    globalThis.chrome={storage:{local:{async get(){return structuredClone(stored)},async set(value){Object.assign(stored,structuredClone(value))}}},downloads:{download(options){fetch(options.url).then(r=>r.text()).then(text=>{globalThis.downloaded=text;});}}};
  });
  await page.goto("https://extension.test/dashboard.html");
  await page.waitForFunction(()=>document.getElementById("researchStatus").textContent.includes("Unsealed"));
  await page.locator("#protocol > summary").click();
  await page.locator("#cases > summary").click();
  await page.fill("#researchAnnotator","researcher-1");await page.fill("#researchRubric","single-rubric-v1");
  await page.fill("#researchMinGroups","5");await page.fill("#researchMinClass","5");await page.fill("#researchPairs","0");
  for(const id of ["researchPrecision","researchConformance","researchLeakage","researchTaxonomy"])await page.check(`#${id}`);
  await page.fill("#researchEvidence","Synthetic functional-test protocol only. Not an actual research audit or study.");
  await page.click("#sealResearch");
  await page.waitForFunction(()=>document.getElementById("researchStatus").textContent.startsWith("Sealed at"));
  assert.equal(await page.locator("#researchAnnotator").isDisabled(),true);
  if(process.env.CG_RESEARCH_SCREENSHOT)await page.locator("#protocol").screenshot({path:process.env.CG_RESEARCH_SCREENSHOT});
  for(const split of ["validation","test"])for(let i=0;i<15;i++){
    const id=`${split}-${i}`;
    await page.fill("#testId",id);await page.fill("#testUrl",`https://example.com/${id}`);
    await page.selectOption("#testLabel",["low","uncertain","elevated"][i%3]);
    await page.fill("#testRationale",`Observed evidence for ${id}.`);
    await page.fill("#testGroup",`group-${id}`);await page.selectOption("#testSplit",split);await page.selectOption("#testOverlap","LOWER-OVERLAP");
    await page.click('#caseForm button[type="submit"]');
    await page.waitForFunction(id=>document.getElementById("caseStatus").textContent.includes(`Saved ${id}.`),id);
  }
  await page.evaluate(()=>{
    const result=tier=>({tier,score:{low:5,uncertain:45,elevated:80}[tier]});
    stored.scanLogs=stored.testCases.map((item,i)=>{
      const truth=item.groundTruth,wrong=truth==="low"?"elevated":"low",fused=item.split==="validation"?truth:"uncertain";
      return {id:`run-${i}`,scenarioId:item.scenarioId,startedAt:new Date().toISOString(),createdAt:new Date().toISOString(),
        groupId:item.groupId,split:item.split,configId:"thesis-primary-50-50-v1",groundTruth:null,page:{pageStatus:"scoreable",title:item.scenarioId},
        baselines:{textOnly:result(item.split==="validation"?wrong:truth),metadataOnly:result(item.split==="validation"?truth:wrong),multiSignal:result(fused),
          sensitivities:Object.fromEntries(["priorWeight","rawScaling","lowerBoundaries","upperBoundaries"].map(k=>[k,result(fused)]))}};
    });
  });
  await page.click("#exportJson");await page.waitForFunction(()=>globalThis.downloaded);
  const exported=await page.evaluate(()=>JSON.parse(downloaded));
  assert.equal(exported.analysisContract.sealedBeforeHeldOut,true);
  assert.equal(exported.records.length,30);
  assert.ok(exported.records.every(r=>r.reference.rationale===`Observed evidence for ${r.scenarioId}.`&&r.reference.rationaleRecordedBeforePrediction));
  assert.ok(exported.records.every(r=>r.annotatorId==="researcher-1"&&r.annotationProtocolVersion==="single-rubric-v1"&&r.overlapCategory==="LOWER-OVERLAP"&&r.reference.recordedBeforePrediction));
  assert.equal(await page.evaluate(()=>stored.scanLogs.some(r=>r.groundTruth!==null)),false);
  if(process.env.CG_DASHBOARD_PREVIEW_DIR) {
    const dir=process.env.CG_DASHBOARD_PREVIEW_DIR;fs.mkdirSync(dir,{recursive:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>{document.documentElement.style.scrollBehavior="auto";document.getElementById("protocol").open=false;window.scrollTo(0,0);});
    await page.screenshot({path:path.join(dir,"dashboard-desktop.png")});
    await page.locator("#cases").scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(dir,"dashboard-cases.png")});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>window.scrollTo(0,0));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"Mobile page must not overflow horizontally");
    await page.screenshot({path:path.join(dir,"dashboard-mobile.png")});
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>{document.getElementById("protocol").open=true;});
  }
  for (const key of ["cases","history"]) {
    const table=key==="cases"?page.locator("#testCases table"):page.locator("#records").locator("..");
    const body=table.locator("tbody"), caseColumn=key==="cases"?0:1;
    const firstId=()=>body.locator("tr").first().locator("td").nth(caseColumn).textContent();
    assert.equal(await body.locator("tr").count(),10);
    assert.equal(await firstId(),"test-0");
    await page.selectOption(`#${key}TableControls select`,"5");
    assert.equal(await body.locator("tr").count(),5);
    await page.click(`#${key}TableControls [data-page="next"]`);
    assert.equal(await firstId(),"test-5");
    await page.click(`#${key}TableControls [data-page="previous"]`);
    assert.equal(await firstId(),"test-0");
    for(const size of ["100","1000"]) {
      await page.selectOption(`#${key}TableControls select`,size);
      assert.equal(await body.locator("tr").count(),30);
    }
    if(key==="cases") {
      const scrolling=await page.evaluate(()=>{
        const controls=document.getElementById("casesTableControls"),wrap=document.querySelector("#testCases .table-wrap");
        const before=controls.getBoundingClientRect().top;
        wrap.scrollTop=100;wrap.scrollLeft=100;
        return {outside:!wrap.contains(controls),scrolled:wrap.scrollTop>0,unchanged:controls.getBoundingClientRect().top===before};
      });
      assert.deepEqual(scrolling,{outside:true,scrolled:true,unchanged:true});
    }
    await page.selectOption(`#${key}TableControls select`,"custom");
    await page.fill(`#${key}TableControls input`,"7");await page.locator(`#${key}TableControls input`).press("Tab");
    assert.equal(await body.locator("tr").count(),7);
    const headers=table.locator("thead th");
    for(let i=0;i<await headers.count();i++) {
      const header=headers.nth(i);
      await header.locator("button").click();assert.equal(await header.getAttribute("aria-sort"),"ascending");
      await header.locator("button").click();assert.equal(await header.getAttribute("aria-sort"),"descending");
      await header.locator("button").click();
      assert.equal(await firstId(),"test-0");
      assert.equal(await headers.nth(caseColumn).getAttribute("aria-sort"),"ascending");
    }
  }
  const run=payload=>JSON.parse(execFileSync(process.env.CG_PYTHON||"python",["-c","import sys,json; from analysis.evaluate import evaluate; print(json.dumps(evaluate(json.load(sys.stdin),10)))"],{cwd:fileURLToPath(new URL("..",import.meta.url)),input:JSON.stringify(payload),encoding:"utf8"}));
  const report=run(exported);
  assert.equal(report.rq1.status,"Exploratory Improvement");
  assert.equal(report.rq1.test_support.groups,15);assert.equal(report.rq1.validation_support.groups,15);
  assert.deepEqual(report.rq1.missing_gates,[]);
  assert.ok(report.rq1.primary.delta_maoe>0);
  await page.click("#reviseResearch");await page.waitForFunction(()=>stored.analysisContract.sealedBeforeHeldOut===false);
  await page.click("#sealResearch");
  await page.waitForFunction(()=>document.getElementById("researchStatus").textContent.includes("retrospectively"));
  assert.equal(await page.evaluate(()=>stored.analysisContract.sealedBeforeHeldOut),false);
  const unsealed={...exported,analysisContract:{...exported.analysisContract,sealedBeforeHeldOut:false}};
  assert.equal(run(unsealed).rq1.status,"Inconclusive");
  console.log("dashboard controls -> reference registration -> JSON export -> Python RQ1 analysis passed; no manual JSON enrichment and no retroactive sealing");
}finally{await browser.close();}
