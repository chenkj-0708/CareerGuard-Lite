import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreAll } from "../lib/scoring.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, "../fixtures/synthetic");
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, "scenario_manifest.json"), "utf8"));
assert.equal(manifest.filter((item) => item.label === "uncertain").length, 20);
assert.equal(manifest.filter((item) => item.label === "elevated").length, 20);

function extractedPage(item) {
  const source = fs.readFileSync(path.join(fixtureDir, `${item.id}.html`), "utf8");
  const text = source
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const sourceUrl = new URL(item.source_url);
  return {
    url: item.source_url,
    protocol: sourceUrl.protocol,
    title: item.title,
    companyText: item.company,
    visibleText: text,
    links: [item.apply_url],
    externalLinks: [item.apply_url],
    applicationLinks: [item.apply_url],
    emails: item.email ? [item.email] : [],
    contactCues: /whatsapp|telegram|wechat|signal/i.test(text) ? [text.match(/whatsapp|telegram|wechat|signal/i)[0].toLowerCase()] : [],
    extractionQuality: 1,
  };
}

for (const item of manifest) {
  const source = fs.readFileSync(path.join(fixtureDir, `${item.id}.html`), "utf8");
  const expectedNext = item.id.endsWith("-20")
    ? `${item.label}-01.html`
    : `${item.label}-${String(Number(item.id.slice(-2)) + 1).padStart(2, "0")}.html`;
  assert.match(source, new RegExp(`class="next-button" href="${expectedNext}"`), `${item.id} has an invalid next link`);
  const score = scoreAll(extractedPage(item)).multiSignal.score;
  if (item.label === "uncertain") assert.ok(score >= 30 && score < 60, `${item.id} scored ${score}`);
  if (item.label === "elevated") assert.ok(score >= 60, `${item.id} scored ${score}`);
}

console.log("synthetic fixture tests passed");
