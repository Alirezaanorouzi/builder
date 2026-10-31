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
