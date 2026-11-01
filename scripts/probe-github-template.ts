import "dotenv/config";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local"), override: true });

import { getPlatformConfig } from "../src/lib/config";

async function main() {
  const p = getPlatformConfig();
  if (!p.githubToken) {
    console.error("Missing PLATFORM_GITHUB_TOKEN");
    process.exit(1);
  }
  const url = `https://api.github.com/repos/${p.templateOwner}/${p.templateRepo}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${p.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  console.log("GET", url, "→", res.status);
  if (!res.ok) {
    console.log(await res.text());
    process.exit(1);
  }
  const data = (await res.json()) as {
    full_name: string;
    private: boolean;
    is_template?: boolean;
    permissions?: Record<string, boolean>;
  };
  console.log("full_name:", data.full_name);
  console.log("private:", data.private);
  console.log("is_template:", data.is_template);
  console.log("permissions:", data.permissions);

  const genUrl = `${url}/generate`;
  const probe = await fetch(genUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      owner: p.githubRepoOwner,
      name: `builder-probe-${Date.now()}`,
      private: false,
    }),
  });
  console.log("POST generate (probe) →", probe.status);
  const probeText = await probe.text();
  if (probe.status === 201) {
    const created = JSON.parse(probeText) as { full_name: string };
    console.log("Created probe repo:", created.full_name);
    const del = await fetch(`https://api.github.com/repos/${created.full_name}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${p.githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    console.log("Deleted probe →", del.status);
  } else {
    console.log(probeText.slice(0, 500));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
