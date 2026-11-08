/** Map worker provisioning step → bottom bar fill (0–100). */
const STEP_PERCENT: Record<string, number> = {
  pending_github_repo: 14,
  github_repo_created: 32,
  pending_vercel_project: 46,
  vercel_project_created: 82,
  /** Legacy step after deploy-wait removal — treated like vercel_project_created. */
  pending_initial_deploy: 82,
  complete: 96,
};

export function provisioningProgressPercent(
  step: string | null | undefined,
  siteStatus: string | null | undefined
): number {
  if (siteStatus === "active") return 100;
  if (siteStatus !== "provisioning") return 10;
  if (!step) return 10;
  return STEP_PERCENT[step] ?? 18;
}
