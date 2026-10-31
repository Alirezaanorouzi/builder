import { getConfig } from "./config";

interface VercelDeployment {
  uid: string;
  url: string;
  state: string;
  readyState?: string;
  createdAt: number;
  meta?: { githubCommitSha?: string };
}

interface DeploymentsResponse {
  deployments: VercelDeployment[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function deploymentsTeamQuery(teamId: string | undefined): string {
  if (!teamId) return "";
  if (teamId.startsWith("team_")) {
    return `&teamId=${encodeURIComponent(teamId)}`;
  }
  return "";
}

function vercel403Help(teamId: string | undefined): string {
  const parts = [
    "Vercel returned 403 Not authorized when listing deployments.",
    "Fix: create a token at https://vercel.com/account/tokens while your team is selected (Full Account access).",
    "Set VERCEL_TEAM_ID to the team id (starts with team_), not the dashboard slug like alirezas-projects-…. ",
    "For this project the team id is team_BNUcVJabhzSdiAM18A5IIeu4.",
  ];
  if (teamId && !teamId.startsWith("team_")) {
    parts.push(
      `Your VERCEL_TEAM_ID looks like a slug ("${teamId}") — replace it with the team_ id above.`
    );
  }
  return parts.join(" ");
}

async function fetchDeployments(projectId: string, teamId: string | undefined, token: string) {
  const teamQuery = deploymentsTeamQuery(teamId);
  const url = `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=20${teamQuery}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { res, url };
}

export type PreviewUrlResult = {
  url: string | null;
  note?: string;
  deploymentId?: string;
  commitSha?: string;
};

export type DeploymentResult = PreviewUrlResult;

function deploymentMatchesCommit(d: VercelDeployment, commitSha?: string): boolean {
  if (!commitSha) return true;
  const sha = d.meta?.githubCommitSha;
  if (!sha) return false;
  return sha === commitSha || sha.startsWith(commitSha) || commitSha.startsWith(sha);
}

export async function waitForDeployment(options: {
  projectId: string;
  teamId?: string;
  productionUrl?: string;
  commitSha?: string;
  sinceMs?: number;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<DeploymentResult> {
  const cfg = getConfig();
  const projectId = options.projectId;
  const teamId = options.teamId ?? cfg.vercelTeamId;
  const sinceMs = options.sinceMs ?? Date.now() - 60_000;
  const maxAttempts = options.maxAttempts ?? 30;
  const delayMs = options.delayMs ?? 10_000;
  const commitSha = options.commitSha?.trim();
  const fallbackProduction = options.productionUrl ?? cfg.vercelProductionUrl;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let { res } = await fetchDeployments(projectId, teamId, cfg.vercelToken);

    if (res.status === 403 && teamId && !teamId.startsWith("team_")) {
      ({ res } = await fetchDeployments(projectId, undefined, cfg.vercelToken));
    }

    if (!res.ok) {
      const err = await res.text();
      if (res.status === 403) {
        const fallback = productionFallbackWithUrl(
          fallbackProduction,
          "Could not list deployments (Vercel token/team). Showing last known production URL — a new deploy may still be building or blocked on Vercel."
        );
        if (fallback) return fallback;
        throw new Error(`${vercel403Help(teamId)} Raw: ${err}`);
      }
      throw new Error(`Vercel API error (${res.status}): ${err}`);
    }

    const data = (await res.json()) as DeploymentsResponse;
    const candidates = data.deployments
      .filter((d) => {
        const state = d.readyState ?? d.state;
        if (state !== "READY") return false;
        if (d.createdAt < sinceMs - 120_000) return false;
        return deploymentMatchesCommit(d, commitSha);
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    const ready = candidates[0];
    if (ready?.url) {
      const url = ready.url.startsWith("http") ? ready.url : `https://${ready.url}`;
      return {
        url,
        deploymentId: ready.uid,
        commitSha: ready.meta?.githubCommitSha ?? commitSha,
      };
    }

    await sleep(delayMs);
  }

  if (commitSha) {
    const fallback = productionFallbackWithUrl(
      fallbackProduction,
      `No READY deployment found for commit ${commitSha.slice(0, 7)} yet. Showing production URL if available.`
    );
    if (fallback) return { ...fallback, commitSha };
  }

  const fallback = productionFallbackWithUrl(
    fallbackProduction,
    "No new READY deployment appeared in time. Showing production URL — check Vercel if the latest git push was blocked."
  );
  if (fallback) return fallback;

  return { url: null };
}

/** @deprecated Use waitForDeployment */
export async function waitForPreviewUrl(options?: {
  sinceMs?: number;
  maxAttempts?: number;
  delayMs?: number;
  projectId?: string;
  teamId?: string;
  productionUrl?: string;
}): Promise<PreviewUrlResult> {
  const cfg = getConfig();
  return waitForDeployment({
    projectId: options?.projectId ?? cfg.vercelProjectId,
    teamId: options?.teamId ?? cfg.vercelTeamId,
    productionUrl: options?.productionUrl ?? cfg.vercelProductionUrl,
    sinceMs: options?.sinceMs,
    maxAttempts: options?.maxAttempts,
    delayMs: options?.delayMs,
  });
}

function productionFallbackWithUrl(productionUrl: string | undefined, note: string): PreviewUrlResult | null {
  if (!productionUrl) return null;
  const url = productionUrl.startsWith("http") ? productionUrl : `https://${productionUrl}`;
  return { url, note };
}
