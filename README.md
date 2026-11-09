# Website Builder MVP

Minimal chat app that sends prompts to **Cursor Cloud Agents**, streams build progress over **SSE**, and returns a **Vercel preview URL** when deploy finishes.

Optional self-hosted OpenCode lives in [builder-opencode-engine](https://github.com/Alirezaanorouzi/builder-opencode-engine) (not used by this repo).

## What you need before running

1. **Cursor** — Premium (or higher) with Cloud Agents enabled and GitHub connected in [Integrations](https://cursor.com/dashboard).
2. **API key** — [Dashboard → API Keys](https://cursor.com/dashboard) → set `CURSOR_API_KEY`.
3. **Template repo** — Push `template/` to GitHub (private is fine). Cursor must have read/write access.
4. **Vercel** — Import the same GitHub repo as a project. Note **Project ID** and create a [token](https://vercel.com/account/tokens).

> **Multi-tenant:** Per-user sites get their own GitHub repo + Vercel project after sign-in. See [docs/PROVISIONING.md](docs/PROVISIONING.md) and [docs/DATABASE.md](docs/DATABASE.md).

## Setup

```bash
cd builder
cp .env.example .env.local
# Edit .env.local with your keys and repo URL

npm install
npm run db:migrate
npm run dev
# In another terminal (or set INLINE_BUILD_WORKER=1 in .env.local):
npm run worker
```

Open [http://localhost:3000](http://localhost:3000).

## Agent gateway (region-blocked hosts)

If the server egress is blocked by Cursor (“not available in your region”), deploy the gateway to **Vercel** from **[`builder-cursor-gateway`](https://github.com/Alirezaanorouzi/builder-cursor-gateway)** (sync from [`gateway/`](gateway/) with `npm run sync:gateway-github:push`; that folder is excluded from Liara via `.liaraignore`). The gateway holds `CURSOR_API_KEY`; the builder uses **`CURSOR_TRANSPORT=gateway`**, **`ENGINE_GATEWAY_URL`** (project origin, no path), and **`ENGINE_GATEWAY_TOKEN`** (same value as on Vercel). Then **remove `CURSOR_API_KEY` from Liara** so the key never transits the blocked region.

Test connectivity: `npx tsx scripts/probe-gateway.ts`

## Environment variables

| Variable | Description |
|----------|-------------|
| `CURSOR_TRANSPORT` | `direct` (default) or `gateway` |
| `CURSOR_API_KEY` | Cursor API key (`direct` only; optional on builder when using gateway) |
| `ENGINE_GATEWAY_URL` | Vercel gateway origin, e.g. `https://your-app.vercel.app` (`gateway` only) |
| `ENGINE_GATEWAY_TOKEN` | Shared secret with the gateway (`gateway` only) |
| `TEMPLATE_REPO_URL` | e.g. `https://github.com/you/clinic-template` |
| `TEMPLATE_REPO_REF` | Branch agent pushes to (default `main`) — must match Vercel production branch |
| `VERCEL_TOKEN` | Vercel API token |
| `VERCEL_PROJECT_ID` | Optional legacy single-project id; multi-tenant uses per-site projects |
| `VERCEL_TEAM_ID` | Optional, if project is under a team |
| `CURSOR_MODEL_ID` | Cloud Agent model (default `composer-2.5` **standard** via `fast=false` param; dashboard default does not apply to API) |

Agent options used:

- `workOnCurrentBranch: true` — commits go to `main` so Vercel auto-deploys.
- `autoCreatePR: false` — direct push for simpler MVP.

## Flow

1. User sends a message → `POST /api/chat/send` creates a **BuildRun** (`queued`) for the site (one active build per site).
2. **Worker** (`npm run worker` or `INLINE_BUILD_WORKER=1`) runs the job via **`@cursor/sdk`** (direct) or a **REST + SSE** path (`CURSOR_TRANSPORT=gateway`); live UI events are written to the **`BuildEvent`** table in Postgres (pruned after 7 days). Because events live in the database, the worker can run in a separate process/app without breaking the live UI.
3. Client opens `GET /api/chat/stream?buildRunId=` → the route tails `BuildEvent` rows (resumable with `Last-Event-ID`). After the agent finishes, the run moves through `pushing` → `deploying` and only becomes `succeeded` once Vercel reports a **READY** deployment of the pushed commit; only then does the preview unlock.
4. **SiteResources** stores `cursorAgentId` (single source of truth) for follow-up runs on the same site.
5. **Recovery:** the worker heartbeats its run every 15s. If it dies, another worker (or the restarted one) re-attaches to the Cursor run by `engineRunId`, or re-queues the run if the agent had not started yet. Runs never exceed `BUILD_RUN_MAX_MINUTES` (default 45).

Existing sites created before the preview gate can be backfilled once with `npm run backfill:preview-gate` (`/api/me` no longer calls GitHub/Vercel).

Auth + sites use **PostgreSQL** (`DATABASE_URL`). See [docs/DATABASE.md](docs/DATABASE.md) (Liara, Docker, or Neon).

**Production on Liara:** [docs/LIARA.md](docs/LIARA.md) — `liara.json`, `@liara/cli`, and env vars on the Liara app.

## Project layout

```
src/app/api/           — thin HTTP routes
src/lib/               — auth, db, access, build queue, worker loop, chat-send
src/services/          — GitHub, Vercel, Cursor, provisioning, build orchestrator
engines/cursor/        — Cursor engine adapters (SDK + REST gateway)
gateway/               — optional Vercel proxy for Cursor API (region bypass)
src/components/Chat.tsx
template/              — Foundation v2 for GitHub template (`npm run sync:template-github:push` → builder-website-template)
scripts/               — worker, prisma CLI, ops probes
```

## Troubleshooting

- **usage_limit_exceeded / 403** — Cloud Agents need a paid Cursor plan with usage available; see [pricing](https://www.cursor.com/pricing).
- **Missing env** — Server returns 500 with a clear message.
- **409 agent busy** — Wait for the current run to finish, or send again after restart (stale runs are cleared). Use `INLINE_BUILD_WORKER=1` or `npm run worker`.
- **Agent edits on “hi” / thanks** — User text is sent as-is (no app wrapper). Behavior comes from repo **`AGENTS.md`** (see `template/AGENTS.md`). Update that file in each customer GitHub repo (or re-provision from an updated template).
- **Prisma P1001 / connection reset (Liara)** — Remote Postgres closed the connection. Confirm Liara is reachable; for local dev use `npm run db:up` and a local `DATABASE_URL`. Live events are written to Postgres (`BuildEvent`), so DB outages stall the live UI.
- **No preview URL** — Confirm Vercel is linked to the repo, deploy succeeded, and `VERCEL_PROJECT_ID` is correct. First deploy may take a few minutes after the agent pushes.
- **Vercel: “Deployment was blocked … commit author did not have contributing access”** — On **Hobby**, **private** GitHub repos only deploy commits whose **author email matches the GitHub account linked to Vercel**. Ensure Cursor commits as that GitHub user; import the repo on **your** Vercel team, make the repo **public**, or upgrade to **Pro**.
