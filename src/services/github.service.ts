import { assertPlatformProvisioningConfig, getPlatformConfig } from "@/lib/config";

export interface CreatedGitHubRepo {
  id: number;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
}

type TemplateRepoMeta = {
  fullName: string;
  isTemplate: boolean;
  httpStatus: number;
};

async function githubApi(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const platform = getPlatformConfig();
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${platform.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
}

/** Preflight for ops — one template repo, unlimited generated customer repos. */
export async function fetchTemplateRepoMeta(): Promise<TemplateRepoMeta> {
  const platform = assertPlatformProvisioningConfig();
  const res = await githubApi(`/repos/${platform.templateOwner}/${platform.templateRepo}`);
  if (!res.ok) {
    return {
      fullName: `${platform.templateOwner}/${platform.templateRepo}`,
      isTemplate: false,
      httpStatus: res.status,
    };
  }
  const data = (await res.json()) as { full_name: string; is_template?: boolean };
  return {
    fullName: data.full_name,
    isTemplate: Boolean(data.is_template),
    httpStatus: res.status,
  };
}

function templateNotReadyMessage(meta: TemplateRepoMeta): string {
  const platform = getPlatformConfig();
  const name = `${platform.templateOwner}/${platform.templateRepo}`;
  if (meta.httpStatus === 404) {
    return (
      `GitHub template repo not reachable (${name}). ` +
      `Check TEMPLATE_REPO_URL and that PLATFORM_GITHUB_TOKEN has repo scope and can read that repo (404 also means "no access" for private repos).`
    );
  }
  if (!meta.isTemplate) {
    return (
      `GitHub repo ${meta.fullName} is not a template. ` +
      `Open GitHub → Settings → General → enable **Template repository**.`
    );
  }
  return `GitHub template ${meta.fullName} is not ready (HTTP ${meta.httpStatus}).`;
}

export async function assertGitHubTemplateReady(): Promise<void> {
  const meta = await fetchTemplateRepoMeta();
  if (meta.httpStatus !== 200 || !meta.isTemplate) {
    throw new Error(templateNotReadyMessage(meta));
  }
}

export async function findGitHubRepoByName(
  repoName: string
): Promise<CreatedGitHubRepo | null> {
  const platform = assertPlatformProvisioningConfig();
  const res = await githubApi(`/repos/${platform.githubRepoOwner}/${repoName}`);
  if (!res.ok) return null;
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

export async function createRepoFromTemplate(options: {
  repoName: string;
  description?: string;
  isPrivate?: boolean;
}): Promise<CreatedGitHubRepo> {
  const platform = assertPlatformProvisioningConfig();
  await assertGitHubTemplateReady();

  const res = await githubApi(
    `/repos/${platform.templateOwner}/${platform.templateRepo}/generate`,
    {
      method: "POST",
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
      const meta = await fetchTemplateRepoMeta();
      throw new Error(`${templateNotReadyMessage(meta)} Raw: ${text}`);
    }
    if (res.status === 422 && text.includes("name already exists")) {
      const existing = await findGitHubRepoByName(options.repoName);
      if (existing) return existing;
      throw new Error(
        `GitHub repo name "${options.repoName}" already exists under ${platform.githubRepoOwner}. Retry provisioning or rename. Raw: ${text}`
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
