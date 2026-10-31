# Site provisioning (GitHub + Vercel)

Each **Site** gets its own GitHub repository and Vercel project. Provisioning is **recoverable**: steps are persisted on `SiteResources.provisioningStep` and failures set `Site.status = failed` with `provisioningError`.

## Prerequisites (manual)

1. **GitHub template** — The repo in `TEMPLATE_REPO_URL` (e.g. `builder-clinic-template`) must have **Template repository** enabled in GitHub Settings (`is_template: true`). The Generate from Template API fails otherwise.
2. **Starter content** — Prefer a minimal Next.js **skeleton** (routing, Tailwind, deploy config). Customer design comes from chat prompts, not a fixed clinic layout in the template.
3. **Tokens**
   - `PLATFORM_GITHUB_TOKEN` (or `GITHUB_TOKEN`) — create repos from template.
   - `VERCEL_TOKEN` + `VERCEL_TEAM_ID` — create projects; Vercel GitHub integration must access new repos on that team.
   - OpenCode docker: `TEMPLATE_REPO_TOKEN` — push to each provisioned repo.

## Flow

```
Site (provisioning)
  → GitHub generate from template → save githubRepoFullName
  → Vercel POST /v11/projects with gitRepository
  → optional wait for first READY deployment
  → Site (active)
```

## APIs

- `POST /api/sites` — create another site for the user.
- `POST /api/sites/:id/provision` — retry after failure.
- `GET /api/me` — ensures default site exists and kicks provisioning.

## Env

See [.env.example](../.env.example) for `PLATFORM_GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, and multi-tenant flags (`ALLOW_SHARED_MVP_FALLBACK` for legacy single-repo dev only).
