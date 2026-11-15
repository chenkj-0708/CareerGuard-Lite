import assert from "node:assert/strict";
import { checkBackendHealth, BACKEND_URL } from "../lib/backend-client.js";
for (const [indexAvailable, expected] of [[true, "available"], [false, "unavailable"], [undefined, "unknown"]]) {
  const result = await checkBackendHealth(async url => {
    assert.equal(url, `${BACKEND_URL}/health`);
    return { ok: true, async json() { return { ok: true, indexAvailable }; } };
  });
  assert.deepEqual(result, { service: "connected", index: expected });
}
for (const fetcher of [async () => { throw new Error("offline"); }, async () => ({ ok: false }),
  async () => ({ ok: true, async json() { throw new Error("bad JSON"); } }),
  async () => ({ ok: true, async json() { return { ok: false }; } })]) {
  assert.deepEqual(await checkBackendHealth(fetcher), { service: "unavailable", index: "unknown" });
}
for (const slow of [async () => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
  const before = performance.now();
  assert.deepEqual(await checkBackendHealth(slow, 20), { service: "timeout", index: "unknown" });
  assert.ok(performance.now() - before < 1000);
}
console.log("backend connectivity/index separation and fetch/parse deadlines passed");
