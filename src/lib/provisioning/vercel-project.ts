import { assertPlatformProvisioningConfig } from "@/lib/platform-config";

export interface CreatedVercelProject {
  id: string;
  name: string;
  productionUrl: string | null;
}

export async function createVercelProjectForRepo(options: {
  projectName: string;
  githubRepoFullName: string;
}): Promise<CreatedVercelProject> {
  const platform = assertPlatformProvisioningConfig();
  const teamQuery = platform.vercelTeamId
    ? `?teamId=${encodeURIComponent(platform.vercelTeamId)}`
    : "";

  const res = await fetch(`https://api.vercel.com/v11/projects${teamQuery}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${platform.vercelToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: options.projectName,
      framework: "nextjs",
      gitRepository: {
        type: "github",
        repo: options.githubRepoFullName,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Vercel create project failed (${res.status}). Ensure the Vercel GitHub integration can access ${options.githubRepoFullName} on team ${platform.vercelTeamId ?? "personal"}. Raw: ${text}`
    );
  }

  const data = (await res.json()) as {
    id: string;
    name: string;
    link?: { deployment?: { url?: string } };
  };

  const productionUrl = data.link?.deployment?.url
    ? data.link.deployment.url.startsWith("http")
      ? data.link.deployment.url
      : `https://${data.link.deployment.url}`
    : `https://${data.name}.vercel.app`;

  return {
    id: data.id,
    name: data.name,
    productionUrl,
  };
}
