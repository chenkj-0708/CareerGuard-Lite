export const BACKEND_URL = "http://127.0.0.1:8765";
export const HEALTH_TIMEOUT_MS = 2000;

export async function checkBackendHealth(fetcher = fetch, timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("HEALTH_TIMEOUT")); }, timeoutMs);
  });
  try {
    // Deadline includes receiving and decoding the response, even if a client ignores abort.
    const data = await Promise.race([(async () => {
      const response = await fetcher(`${BACKEND_URL}/health`, { method: "POST", signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("HEALTH_HTTP_ERROR");
      const value = await response.json();
      if (!value || value.ok !== true) throw new Error("HEALTH_INVALID_RESPONSE");
      return value;
    })(), deadline]);
    return { service: "connected", index: data.indexAvailable === true ? "available" : data.indexAvailable === false ? "unavailable" : "unknown" };
  } catch (error) {
    return { service: error.message === "HEALTH_TIMEOUT" ? "timeout" : "unavailable", index: "unknown" };
  } finally { clearTimeout(timer); }
}
