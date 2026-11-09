# Site provisioning (GitHub + Vercel)

Each **Site** gets its own GitHub repository and Vercel project. Provisioning is **recoverable**: steps are persisted on `SiteResources.provisioningStep` and failures set `Site.status = failed` with `provisioningError`.

**Scalability:** You maintain **one** template repo (`TEMPLATE_REPO_URL`). Every new user/site calls GitHub’s [generate from template](https://docs.github.com/rest/repos/repos#create-a-repository-using-a-template) API to create a **new** repo under your org/user (`GITHUB_REPO_OWNER`). That pattern scales to many customers; a 404 is almost always token or template settings—not “one repo per user” failing by design.

## Liara egress

Provisioning calls **`api.github.com`** and **`api.vercel.com`** from the app process. Liara (Iran) can hit **connect timeouts** to Vercel even when `/api/health` sometimes succeeds. Logs show `UND_ERR_CONNECT_TIMEOUT` → site goes **`failed`** with `provisioningError`.

Mitigations today: longer retries in `platform-fetch.ts`. If timeouts persist, run a **Vercel API proxy** in an allowed region (same pattern as the Cursor gateway) or run `npm run worker` outside Liara.

## Prerequisites (manual)

1. **GitHub template** — The repo in `TEMPLATE_REPO_URL` (`Alirezaanorouzi/tempelate1`, formerly `builder-clinic-template`) must have **Template repository** enabled (`is_template: true`). The Generate from Template API fails otherwise.
2. **Starter content** — **Foundation v2** in `template/` (Next 16, Tailwind v4, shadcn primitives, `AGENTS.md`, `TEMPLATE_VERSION`). Publish to GitHub with `npm run sync:template-github:push` (repo `builder-clinic-template`). Customer sites come from chat + agent-created `DESIGN.md`, not pre-built marketing sections.
3. **Tokens**
   - `PLATFORM_GITHUB_TOKEN` (or `GITHUB_TOKEN`) — create repos from template.
   - `VERCEL_TOKEN` + `VERCEL_TEAM_ID` — create projects; Vercel GitHub integration must access new repos on that team.
   - `CURSOR_API_KEY` — Cloud Agents edit the provisioned GitHub repo (GitHub linked in Cursor dashboard).

4. **Vercel ↔ GitHub (required for auto-import)** — Provisioning calls `POST /v11/projects` with `gitRepository`. That only works if the **Vercel GitHub App** on your team can see each new repo:
   - Vercel dashboard → **Settings → Git → GitHub** (connected to the same GitHub user/org as `GITHUB_REPO_OWNER`).
   - Set repository access to **All repositories** (recommended for this product), *or* you must manually grant each new `builder-default-*` repo.
   - If the API creates a project **without** a Git connection, the builder shows an error; manual “Import” in the UI is the same link the API expects when the app finally has access.
   - After link, enable git deploys (`createDeployments`) — the backend PATCHes this on each provision/retry.

## Flow

```
Site (provisioning)
  → GitHub generate from template → save githubRepoFullName
  → Vercel POST /v11/projects with gitRepository
  → optional wait for first READY deployment
  → Site (active)
```

**Preview gate:** `baselineCommitSha` is captured when the customer repo is created. `productionCommitSha` tracks the latest READY Vercel deploy. The app only returns `productionUrl` to the client when those commits differ. Legacy sites backfill both SHAs from Vercel history on `GET /api/me`.

## APIs

- `POST /api/sites` — create another site for the user.
- `POST /api/sites/:id/provision` — retry after failure.
- `GET /api/me` — ensures default site exists and kicks provisioning.

## Verify template (local)

```bash
npx tsx scripts/probe-github-template.ts
```

Expect `is_template: true` and `POST generate (probe) → 201`.

## Env

See [.env.example](../.env.example) for `PLATFORM_GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, and `DATABASE_URL` (PostgreSQL).
