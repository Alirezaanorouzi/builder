import { assertCursorConfig } from "@engines/cursor/provider";

export type CodingEngineId = "cursor";

export function getCodingEngineId(): CodingEngineId {
  return "cursor";
}

/** Platform secrets and defaults for provisioning (not per-customer). */
export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

export function getPlatformConfig() {
  const templateRepoUrl = process.env.TEMPLATE_REPO_URL?.trim() ?? "";
  const parsed = parseGitHubRepo(templateRepoUrl);
  const githubToken =
    process.env.PLATFORM_GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    "";
  const githubRepoOwner =
    process.env.GITHUB_REPO_OWNER?.trim() || parsed?.owner || "";
  const templateOwner = process.env.GITHUB_TEMPLATE_OWNER?.trim() || parsed?.owner || "";
  const templateRepo = process.env.GITHUB_TEMPLATE_REPO?.trim() || parsed?.repo || "";
  const vercelToken = process.env.VERCEL_TOKEN?.trim() ?? "";
  const vercelTeamId = process.env.VERCEL_TEAM_ID?.trim();
  const defaultBranch = process.env.TEMPLATE_REPO_REF?.trim() || "main";

  return {
    templateRepoUrl,
    templateOwner,
    templateRepo,
    githubToken,
    githubRepoOwner,
    vercelToken,
    vercelTeamId,
    defaultBranch,
  };
}

export function assertPlatformProvisioningConfig() {
  const p = getPlatformConfig();
  const missing: string[] = [];
  if (!p.githubToken) missing.push("PLATFORM_GITHUB_TOKEN or GITHUB_TOKEN");
  if (!p.templateOwner || !p.templateRepo) {
    missing.push("TEMPLATE_REPO_URL (or GITHUB_TEMPLATE_OWNER + GITHUB_TEMPLATE_REPO)");
  }
  if (!p.githubRepoOwner) missing.push("GITHUB_REPO_OWNER");
  if (!p.vercelToken) missing.push("VERCEL_TOKEN");
  if (missing.length) {
    throw new Error(`Provisioning config: ${missing.join(", ")}`);
  }
  return p;
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
  };
}

export function assertServerConfig() {
  const c = getConfig();
  const missing: string[] = [];

  if (!c.vercelToken) missing.push("VERCEL_TOKEN");

  try {
    assertCursorConfig();
  } catch (e) {
    missing.push(e instanceof Error ? e.message : "CURSOR_API_KEY");
  }

  if (missing.length) {
    throw new Error(`Missing env: ${missing.join(", ")}. Copy .env.example to .env.local`);
  }
  return c;
}
