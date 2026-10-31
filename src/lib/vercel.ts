import { getConfig } from "./config";

interface VercelDeployment {
  uid: string;
  url: string;
  state: string;
  readyState?: string;
  createdAt: number;
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
  const url = `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=5${teamQuery}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { res, url };
}

export type PreviewUrlResult = {
  url: string | null;
  /** Shown in chat when URL is not from a fresh READY deployment. */
  note?: string;
};

function productionFallback(cfg: ReturnType<typeof getConfig>, note: string): PreviewUrlResult | null {
  if (!cfg.vercelProductionUrl) return null;
  const url = cfg.vercelProductionUrl.startsWith("http")
    ? cfg.vercelProductionUrl
    : `https://${cfg.vercelProductionUrl}`;
  return { url, note };
}

export async function waitForPreviewUrl(options?: {
  sinceMs?: number;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<PreviewUrlResult> {
  const cfg = getConfig();
  const sinceMs = options?.sinceMs ?? Date.now() - 60_000;
  const maxAttempts = options?.maxAttempts ?? 30;
  const delayMs = options?.delayMs ?? 10_000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let { res } = await fetchDeployments(cfg.vercelProjectId, cfg.vercelTeamId, cfg.vercelToken);

    if (res.status === 403 && cfg.vercelTeamId && !cfg.vercelTeamId.startsWith("team_")) {
      ({ res } = await fetchDeployments(cfg.vercelProjectId, undefined, cfg.vercelToken));
    }

    if (!res.ok) {
      const err = await res.text();
      if (res.status === 403) {
        const fallback = productionFallback(
          cfg,
          "Could not list deployments (Vercel token/team). Showing last known production URL — a new deploy may still be building or blocked on Vercel."
        );
        if (fallback) return fallback;
        throw new Error(`${vercel403Help(cfg.vercelTeamId)} Raw: ${err}`);
      }
      throw new Error(`Vercel API error (${res.status}): ${err}`);
    }

    const data = (await res.json()) as DeploymentsResponse;
    const ready = data.deployments
      .filter((d) => {
        const state = d.readyState ?? d.state;
        return state === "READY" && d.createdAt >= sinceMs - 120_000;
      })
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (ready?.url) {
      const url = ready.url.startsWith("http") ? ready.url : `https://${ready.url}`;
      return { url };
    }

    await sleep(delayMs);
  }

  const fallback = productionFallback(
    cfg,
    "No new READY deployment appeared in time. Showing production URL — check Vercel if the latest git push was blocked."
  );
  if (fallback) return fallback;

  return { url: null };
}
