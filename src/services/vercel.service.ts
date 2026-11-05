import { assertPlatformProvisioningConfig, getConfig } from "@/lib/config";
import { VERCEL_DEPLOY_POLL_INTERVAL_MS, VERCEL_DEPLOY_POLL_MAX_ATTEMPTS } from "@/lib/vercel-deploy-poll";

export interface CreatedVercelProject {
  id: string;
  name: string;
  productionUrl: string | null;
}

type VercelProjectLink = {
  type?: string;
  org?: string;
  repo?: string;
  repoId?: number;
  productionBranch?: string;
};

type VercelProjectDetails = {
  id: string;
  name: string;
  link?: VercelProjectLink | null;
  targets?: { production?: { url?: string } };
  gitProviderOptions?: {
    createDeployments?: string;
    disableRepositoryDispatchEvents?: boolean;
  };
};

type VercelProjectListItem = VercelProjectDetails;

function teamQuery(teamId: string | undefined): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

function vercelHeaders(token: string, json = false): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid GitHub repo full name: ${fullName}`);
  return { owner, repo };
}

function productionUrlFromProject(project: {
  name: string;
  targets?: { production?: { url?: string } };
}): string {
  const u = project.targets?.production?.url;
  if (u) return u.startsWith("http") ? u : `https://${u}`;
  return `https://${project.name}.vercel.app`;
}

export function vercelProjectLinksRepo(
  project: { link?: VercelProjectLink | null },
  githubRepoFullName: string
): boolean {
  const link = project.link;
  if (!link || link.type !== "github") return false;
  const { owner, repo } = parseRepoFullName(githubRepoFullName);
  return link.org === owner && link.repo === repo;
}

export async function getVercelProjectDetails(
  projectIdOrName: string,
  platform: ReturnType<typeof assertPlatformProvisioningConfig>
): Promise<VercelProjectDetails | null> {
  const q = teamQuery(platform.vercelTeamId);
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(projectIdOrName)}${q}`,
    { headers: vercelHeaders(platform.vercelToken) }
  );
  if (!res.ok) return null;
  return (await res.json()) as VercelProjectDetails;
}

export async function findVercelProjectByName(
  projectName: string,
  platform: ReturnType<typeof assertPlatformProvisioningConfig>
): Promise<CreatedVercelProject | null> {
  const q = teamQuery(platform.vercelTeamId);
  const search = q ? `${q}&search=${encodeURIComponent(projectName)}` : `?search=${encodeURIComponent(projectName)}`;
  const res = await fetch(`https://api.vercel.com/v9/projects${search}`, {
    headers: vercelHeaders(platform.vercelToken),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { projects?: VercelProjectListItem[] };
  const exact = data.projects?.find((p) => p.name === projectName);
  if (!exact) return null;
  return {
    id: exact.id,
    name: exact.name,
    productionUrl: productionUrlFromProject(exact),
  };
}

/** Enable git push → Vercel deploy (API defaults often leave createDeployments disabled). */
export async function enableVercelGitDeployments(
  projectId: string,
  platform: ReturnType<typeof assertPlatformProvisioningConfig>
): Promise<void> {
  const q = teamQuery(platform.vercelTeamId);
  const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}${q}`, {
    method: "PATCH",
    headers: vercelHeaders(platform.vercelToken, true),
    body: JSON.stringify({
      gitProviderOptions: {
        createDeployments: "enabled",
        disableRepositoryDispatchEvents: false,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn("[vercel] enable git deployments failed:", res.status, text.slice(0, 200));
  }
}

/** Ask Vercel to deploy the linked GitHub repo (e.g. after first link). */
export async function requestGitProductionDeploy(options: {
  projectId: string;
  githubRepoFullName: string;
  link?: VercelProjectLink | null;
  ref?: string;
}): Promise<void> {
  const platform = assertPlatformProvisioningConfig();
  const { owner, repo } = parseRepoFullName(options.githubRepoFullName);
  const ref = options.ref ?? platform.defaultBranch;
  const teamQ = teamQuery(platform.vercelTeamId);
  const gitSource: Record<string, string | number> = {
    type: "github",
    ref,
    org: owner,
    repo,
  };
  if (options.link?.repoId) gitSource.repoId = options.link.repoId;

  const res = await fetch(`https://api.vercel.com/v13/deployments${teamQ}`, {
    method: "POST",
    headers: vercelHeaders(platform.vercelToken, true),
    body: JSON.stringify({
      name: repo,
      project: options.projectId,
      target: "production",
      gitSource,
      projectSettings: {
        framework: "nextjs",
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn("[vercel] git deploy request failed:", res.status, text.slice(0, 300));
  }
}

function gitLinkHelp(githubRepoFullName: string, teamId: string | undefined): string {
  return (
    `Vercel project was created but GitHub repo ${githubRepoFullName} is not connected. ` +
    `On the Vercel team (${teamId ?? "personal"}), open Settings → Git → GitHub and grant access to **All repositories** ` +
    `(or add this repo). New repos created by the platform token are invisible to Vercel until the GitHub App can access them. ` +
    `Then click Retry setup in the builder.`
  );
}

export async function createVercelProjectForRepo(options: {
  projectName: string;
  githubRepoFullName: string;
}): Promise<CreatedVercelProject> {
  const platform = assertPlatformProvisioningConfig();
  const teamQ = teamQuery(platform.vercelTeamId);

  let projectId: string;
  let projectName: string;
  let productionUrl: string;

  const existing = await findVercelProjectByName(options.projectName, platform);
  if (existing) {
    projectId = existing.id;
    projectName = existing.name;
    productionUrl = existing.productionUrl ?? `https://${existing.name}.vercel.app`;
  } else {
    const res = await fetch(`https://api.vercel.com/v11/projects${teamQ}`, {
      method: "POST",
      headers: vercelHeaders(platform.vercelToken, true),
      body: JSON.stringify({
        name: options.projectName,
        framework: "nextjs",
        gitRepository: {
          type: "github",
          repo: options.githubRepoFullName,
        },
      }),
    });

    if (res.status === 409) {
      const again = await findVercelProjectByName(options.projectName, platform);
      if (!again) {
        throw new Error(`Vercel project name ${options.projectName} conflict but project not found`);
      }
      projectId = again.id;
      projectName = again.name;
      productionUrl = again.productionUrl ?? `https://${again.name}.vercel.app`;
    } else if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Vercel create project failed (${res.status}) for ${options.githubRepoFullName}. ` +
          `Check VERCEL_TOKEN scope and VERCEL_TEAM_ID (${platform.vercelTeamId ?? "personal"}), ` +
          `and that the Vercel GitHub App can access the repo. Raw: ${text}`
      );
    } else {
      const data = (await res.json()) as {
        id: string;
        name: string;
        link?: { deployment?: { url?: string } };
      };
      projectId = data.id;
      projectName = data.name;
      productionUrl = data.link?.deployment?.url
        ? data.link.deployment.url.startsWith("http")
          ? data.link.deployment.url
          : `https://${data.link.deployment.url}`
        : `https://${data.name}.vercel.app`;
    }
  }

  const details = await getVercelProjectDetails(projectId, platform);
  if (!details || !vercelProjectLinksRepo(details, options.githubRepoFullName)) {
    throw new Error(gitLinkHelp(options.githubRepoFullName, platform.vercelTeamId));
  }

  await enableVercelGitDeployments(projectId, platform);
  await requestGitProductionDeploy({
    projectId,
    githubRepoFullName: options.githubRepoFullName,
    link: details.link,
  });

  return {
    id: projectId,
    name: projectName,
    productionUrl,
  };
}

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
    "Set VERCEL_TEAM_ID to the team id (starts with team_), not the dashboard slug.",
  ];
  if (teamId && !teamId.startsWith("team_")) {
    parts.push(
      `Your VERCEL_TEAM_ID looks like a slug ("${teamId}") — replace it with the team_ id from Vercel team settings.`
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

function productionFallbackWithUrl(productionUrl: string | undefined, note: string): PreviewUrlResult | null {
  if (!productionUrl) return null;
  const url = productionUrl.startsWith("http") ? productionUrl : `https://${productionUrl}`;
  return { url, note };
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
  const maxAttempts = options.maxAttempts ?? VERCEL_DEPLOY_POLL_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? VERCEL_DEPLOY_POLL_INTERVAL_MS;
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
