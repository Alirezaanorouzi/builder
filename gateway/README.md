# Agent + Vercel deploy gateway (Vercel)

Small **Next.js 15 App Router** proxy: your builder (e.g. on Liara) calls this with shared secrets; the gateway forwards **only** allow-listed paths upstream.

**Source of truth for Vercel:** [`builder-cursor-gateway`](https://github.com/Alirezaanorouzi/builder-cursor-gateway) (not the Liara app — `gateway/` is in [`.liaraignore`](../.liaraignore)). Edit `builder/gateway/` here, then from repo root:

```bash
npm run sync:gateway-github:push
```

## Deploy

1. Vercel project connected to **`Alirezaanorouzi/builder-cursor-gateway`**, branch **`main`** (repo root = app root; no `gateway/` subfolder in that repo).
2. Set env on the Vercel project:
   - `CURSOR_API_KEY` — Cursor API key (stays on Vercel only)
   - `ENGINE_GATEWAY_TOKEN` — long random secret; copy to the builder as `ENGINE_GATEWAY_TOKEN` (Cursor routes)
   - `ENGINE_GATEWAY_TOKEN_VERCEL` — **recommended** separate secret for Vercel routes; builder sets the same value (falls back to `ENGINE_GATEWAY_TOKEN` if unset)
   - `VERCEL_TOKEN` — **dedicated** token for this project only (do not reuse Liara’s full admin token; set expiration in Vercel)
   - `VERCEL_TEAM_ID` — `team_…` from team settings (required for deployments list; **not** accepted from clients)
3. Region is pinned in `vercel.json` (`fra1` by default).
4. Builder uses **`https://your-project.vercel.app`** as `ENGINE_GATEWAY_URL` (no path suffix).

## Allow-listed routes

### Cursor (`/api/cursor/...`)

Create agent, follow-up run, get run, run stream, cancel, and **GET usage** (`v1/agents/{bc-…}/usage?runId=run-…` only — no extra query params). Auth: `Bearer ENGINE_GATEWAY_TOKEN`.

### Vercel deployments (`GET /api/vercel/v6/deployments`)

- **Methods:** GET only
- **Query (client):** `projectId` (required, `prj_…`), `limit` (1–100, default 40). **Reject `teamId` from client** — gateway adds `teamId` from `VERCEL_TEAM_ID`.
- **Upstream:** `api.vercel.com` with **8s** timeout
- **Response:** filtered deployment list (uid, url, states, created, `meta.githubCommitSha` only); `Cache-Control: no-store`
- **Auth:** `Bearer ENGINE_GATEWAY_TOKEN_VERCEL` or `ENGINE_GATEWAY_TOKEN`

## Security

- Rotate tokens if leaked (`ENGINE_GATEWAY_*` and gateway `VERCEL_TOKEN` independently).
- A caller token leak still allows listing deployments for any `prj_…` visible to the gateway token — use split tokens and a narrow Vercel token.
- Do not commit secrets.

## Probe

From repo root with `.env.local`:

```bash
npx tsx scripts/probe-gateway.ts
npx tsx scripts/probe-gateway.ts --vercel-deployments
```
