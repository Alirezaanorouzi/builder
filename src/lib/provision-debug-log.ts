/** Debug session be4ac0 — provisioning latency (remove after root-cause verified). */
const ENDPOINT =
  "http://127.0.0.1:7519/ingest/8cdbed1e-4117-45dd-b567-91ea13a74a39";
const SESSION = "be4ac0";

const enabled =
  process.env.PROVISION_DEBUG_LOG !== "0" && process.env.PROVISION_DEBUG_LOG !== "false";

export function provisionDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  if (!enabled) return;

  const payload = {
    sessionId: SESSION,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
    runId: process.env.PROVISION_DEBUG_RUN_ID?.trim() || "pre-fix",
  };

  // Liara / production: same Postgres — timings appear in platform logs (npm run logs:liara).
  if (typeof window === "undefined") {
    // #region agent log
    console.info(`[provision-debug] ${JSON.stringify(payload)}`);
    // #endregion
  }

  // Local Cursor debug ingest (browser + optional server when ingest is up).
  // #region agent log
  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": SESSION,
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
  // #endregion
}
