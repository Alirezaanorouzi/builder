import { assertCursorConfig } from "@engines/cursor/provider";
import { assertOpencodeConfig } from "@engines/opencode/provider";

export type CodingEngineId = "cursor" | "opencode";

export function getCodingEngineId(): CodingEngineId {
  const raw = process.env.CODING_ENGINE?.trim().toLowerCase();
  return raw === "opencode" ? "opencode" : "cursor";
}

export function getConfig() {
  const cursorApiKey = process.env.CURSOR_API_KEY?.trim() ?? "";
  const templateRepoUrl = process.env.TEMPLATE_REPO_URL?.trim() ?? "";
  const templateRepoRef = process.env.TEMPLATE_REPO_REF?.trim() || "main";
  const vercelToken = process.env.VERCEL_TOKEN?.trim() ?? "";
  const vercelProjectId = process.env.VERCEL_PROJECT_ID?.trim() ?? "";
  /** Must be `team_…` from Team Settings → General, not the dashboard URL slug. */
  const vercelTeamId = process.env.VERCEL_TEAM_ID?.trim();
  const vercelProductionUrl = process.env.VERCEL_PRODUCTION_URL?.trim();
  const cursorModelId = process.env.CURSOR_MODEL_ID?.trim();
  const opencodeServerUrl = process.env.OPENCODE_SERVER_URL?.trim() || "http://127.0.0.1:4096";
  const opencodeServerUsername = process.env.OPENCODE_SERVER_USERNAME?.trim() || "opencode";
  const opencodeServerPassword = process.env.OPENCODE_SERVER_PASSWORD?.trim() ?? "";
  const opencodeMaxWaitMs = Number(process.env.OPENCODE_MAX_WAIT_MS ?? 900000);
  const opencodeModel =
    process.env.OPENCODE_MODEL?.trim() || "openrouter/openrouter/free";

  return {
    codingEngine: getCodingEngineId(),
    cursorApiKey,
    templateRepoUrl,
    templateRepoRef,
    vercelToken,
    vercelProjectId,
    vercelTeamId,
    vercelProductionUrl,
    cursorModelId,
    cursorApiBase: "https://api.cursor.com",
    opencodeServerUrl,
    opencodeServerUsername,
    opencodeServerPassword,
    opencodeMaxWaitMs,
    opencodeModel,
  };
}

export function assertServerConfig() {
  const c = getConfig();
  const missing: string[] = [];
  const allowLegacy = process.env.ALLOW_SHARED_MVP_FALLBACK === "1";

  if (allowLegacy) {
    if (!c.templateRepoUrl) missing.push("TEMPLATE_REPO_URL");
    if (!c.vercelProjectId) missing.push("VERCEL_PROJECT_ID");
  }

  if (!c.vercelToken) missing.push("VERCEL_TOKEN");

  if (c.codingEngine === "cursor") {
    try {
      assertCursorConfig();
    } catch (e) {
      missing.push(e instanceof Error ? e.message : "CURSOR_API_KEY");
    }
  } else {
    try {
      assertOpencodeConfig();
    } catch (e) {
      missing.push(e instanceof Error ? e.message : "OPENCODE_SERVER_URL");
    }
  }

  if (missing.length) {
    throw new Error(`Missing env: ${missing.join(", ")}. Copy .env.example to .env.local`);
  }
  return c;
}
