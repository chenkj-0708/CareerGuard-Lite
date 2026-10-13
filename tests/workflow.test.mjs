import assert from "node:assert/strict";
let listener;
let stored = {};
let page;
let requests = [];
let failure = false;
let corrupted = false;
globalThis.chrome = {
  sidePanel: { async setPanelBehavior() {} },
  tabs: { async query() { return [{ id: 1, url: "https://example.com/job" }]; }, async sendMessage() { return { ok: true, page }; } },
  scripting: { async executeScript() {} },
  storage: { local: { async get() { return stored; }, async set(value) { Object.assign(stored, value); } } },
  runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } }
};
globalThis.fetch = async (url, options) => {
  if (failure) throw new Error("offline");
  if (url.endsWith("/health")) return { ok: true, async json() { return { token: "short-lived" }; } };
  const body = JSON.parse(options.body); requests.push(body);
  return { ok: true, async json() { return corrupted ? { score: 0 } : { schemaVersion: 2, request_id: body.request_id,
    score: 0, checks: { contact_domain_match: { status: "contradicted" } } }; } };
};
await import("../background.js");
const scan = () => new Promise(resolve => listener({ type: "CG_SCAN", options: { mode: "multiSignal", autoEscalate: true } }, {}, resolve));
page = { extractionStatus: "unavailable", domain: "example.com", siteType: "Generic" };
assert.equal((await scan()).ok, false);
assert.equal(requests.length, 0);
assert.equal(stored.lastScan, null);
page = { extractionStatus: "reliable", visibleText: "Urgent hiring. Pay a registration fee. Contact WhatsApp. Guaranteed income. Send bank account details. ".repeat(8),
 url: "https://example.com/job", protocol: "https:", domain: "example.com", title: "Engineer", companyDomain: "example.com", emails: ["recruiter@gmail.com"],
 links: [], externalLinks: [], applicationLinks: [], contactCues: ["whatsapp"], extractionQuality: 1 };
for (const mode of ["success", "offline", "corrupted"]) {
 failure = mode === "offline"; corrupted = mode === "corrupted";
 const response = await scan(); assert.equal(response.ok, true);
 assert.equal(response.record.displayedResult.score, response.record.baselines.multiSignal.score);
 assert.equal(response.record.displayedResult.tier, response.record.baselines.multiSignal.tier);
 assert.equal(response.record.escalation.status, mode === "success" ? "completed" : "unavailable");
}
assert.deepEqual(Object.keys(requests[0]).sort(), ["request_id", "timestamp", "nonce", "company_domain", "contact_domain", "requested_checks"].sort());
assert.ok(!JSON.stringify(requests).includes("recruiter@"));
assert.ok(!JSON.stringify(stored).includes(page.visibleText));
console.log("workflow privacy, extraction stop, offline and corrupted-response tests passed");
