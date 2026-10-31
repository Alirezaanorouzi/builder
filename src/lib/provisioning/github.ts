import { assertPlatformProvisioningConfig } from "@/lib/platform-config";

export interface CreatedGitHubRepo {
  id: number;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
}

export async function createRepoFromTemplate(options: {
  repoName: string;
  description?: string;
  isPrivate?: boolean;
}): Promise<CreatedGitHubRepo> {
  const platform = assertPlatformProvisioningConfig();

  const res = await fetch(
    `https://api.github.com/repos/${platform.templateOwner}/${platform.templateRepo}/generate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${platform.githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        owner: platform.githubRepoOwner,
        name: options.repoName,
        description: options.description ?? "Website builder customer site",
        private: options.isPrivate ?? false,
        include_all_branches: false,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404) {
      throw new Error(
        `GitHub template generate failed (404). Mark ${platform.templateOwner}/${platform.templateRepo} as a Template repository in GitHub Settings, or check names. Raw: ${text}`
      );
    }
    throw new Error(`GitHub create repo failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    id: number;
    full_name: string;
    html_url: string;
    default_branch?: string;
  };

  return {
    id: data.id,
    fullName: data.full_name,
    htmlUrl: data.html_url,
    defaultBranch: data.default_branch ?? platform.defaultBranch,
  };
}
