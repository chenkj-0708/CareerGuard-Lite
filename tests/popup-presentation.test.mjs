import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.CG_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({headless:true,channel:process.env.CG_BROWSER_CHANNEL || "msedge"});
try {
  const page = await browser.newPage({viewport:{width:380,height:1000}});
  await page.route("https://extension.test/**", route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (!["popup.html","popup.js","popup.css"].includes(path)) return route.abort();
    return route.fulfill({body:fs.readFileSync(new URL(`../${path}`,import.meta.url)),contentType:path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":"text/html"});
  });
  await page.addInitScript(() => {
    globalThis.chrome = {runtime:{onMessage:{addListener(fn){globalThis.receive=fn;}},
      connect({name}){
        globalThis.timingChannel=name;
        const listeners={};
        return {onMessage:{addListener(fn){globalThis.timingMessage=fn;}},
          onDisconnect:{addListener(fn){listeners.disconnect=fn;globalThis.timingDisconnect=fn;}},
          postMessage(message){globalThis.lastRequest=message;}, disconnect(){listeners.disconnect?.();}};
      },
      sendMessage(message){globalThis.lastRequest=message;return new Promise(resolve=>{globalThis.finishScan=resolve;});},openOptionsPage(){}}};
    globalThis.record = {scenarioId:"CG-001",page:{pageStatus:"scoreable"},interfaceCondition:"explanation",totalLatencyMs:150,
      escalation:{status:"pending"},displayedResult:{score:50,tier:"uncertain",ExtractionSufficiency:85,TierBoundaryDistance:30,
        reasons:[{role:"scored",message:"Fee cue"},{role:"context",message:"External link"},{role:"uncertainty",message:"Limited text"}]}};
  });
  await page.goto("https://extension.test/popup.html");
  if(process.env.CG_POPUP_PREVIEW_DIR){
    fs.mkdirSync(process.env.CG_POPUP_PREVIEW_DIR,{recursive:true});
    await page.screenshot({path:`${process.env.CG_POPUP_PREVIEW_DIR}/panel-ready.png`});
  }
  await page.click("#scan");
  // Exercise an old/minimal notification too: pending output must never print an absent ID.
  await page.evaluate(() => {const pending=structuredClone(record);delete pending.scenarioId;receive({type:"CG_LOCAL_RESULT",record:pending});});
  assert.equal(await page.locator("#status").innerText(), "Local result ready; backend lookup in progress.");
  let text = await page.locator("#result").innerText();
  assert.ok(!text.includes("Content reading completeness"));
  for (const label of ["Scoring signal", "Context (no points)", "Information limitation (no points)", "Duplicate listing context", "Lookup in progress"]) assert.ok(text.includes(label));
  assert.equal(await page.locator("details.technical-details").getAttribute("open"), null);
  assert.ok(!text.includes("Distance from risk-tier boundary"));
  await page.click(".technical-details summary");
  assert.ok((await page.locator("#result").innerText()).includes("Distance from risk-tier boundary: 30%"));
  assert.ok((await page.locator("#result").innerText()).includes("Content reading completeness: 85% (not prediction accuracy)"));
  await page.evaluate(() => {record.escalation.status="completed";record.displayedResult.backend={contextReasons:[]};finishScan({ok:true,record});});
  await page.waitForFunction(() => !document.getElementById("scan").disabled);
  assert.ok((await page.locator(".backend-status").innerText()).includes("Lookup completed"));
  for (const [status, expected] of [["unavailable","Backend unavailable"],["not-required","Lookup was not requested"]]) {
    await page.click("#scan");
    await page.evaluate(status => {record.escalation.status=status;delete record.displayedResult.backend;delete record.scenarioId;finishScan({ok:true,record});}, status);
    await page.waitForFunction(() => !document.getElementById("scan").disabled);
    assert.ok((await page.locator(".backend-status").innerText()).includes(expected));
    assert.ok(!(await page.locator("body").innerText()).includes("undefined"));
  }
  await page.click(".research-option summary");
  await page.fill("#caseId","CG-001");
  await page.click("#measureSpeed");
  assert.equal(await page.evaluate(()=>timingChannel), "careerguard-speed");
  assert.deepEqual(await page.evaluate(()=>lastRequest), {type:"start",caseId:"CG-001"});
  assert.equal(await page.locator("#scan").isDisabled(), true);
  await page.evaluate(()=>timingMessage({type:"ready"}));
  await page.evaluate(()=>timingMessage({type:"progress",run:3,total:12}));
  assert.match(await page.locator("#status").innerText(),/Run 3\/12/);
  await page.evaluate(()=>timingMessage({type:"complete",summary:{measured:10,succeeded:9,warmupFailures:0,stopped:null}}));
  await page.waitForFunction(()=>document.getElementById("status").textContent.includes("9/10 measured scans succeeded"));
  assert.equal(await page.locator("#measureSpeed").isEnabled(), true);
  await page.click("#measureSpeed");
  await page.evaluate(()=>timingDisconnect());
  await page.waitForFunction(()=>document.getElementById("status").textContent.includes("chrome://extensions"));
  if(process.env.CG_POPUP_PREVIEW_DIR){
    await page.screenshot({path:`${process.env.CG_POPUP_PREVIEW_DIR}/panel-result.png`});
    await page.setViewportSize({width:280,height:700});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`${process.env.CG_POPUP_PREVIEW_DIR}/panel-narrow.png`});
  }
  console.log("popup pending/completed/unavailable/not-requested states, reference wording and collapsed technical details passed");
} finally { await browser.close(); }
