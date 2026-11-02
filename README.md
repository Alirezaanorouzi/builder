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

## Environment variables

| Variable | Description |
|----------|-------------|
| `CURSOR_API_KEY` | Cursor API key |
| `TEMPLATE_REPO_URL` | e.g. `https://github.com/you/clinic-template` |
| `TEMPLATE_REPO_REF` | Branch agent pushes to (default `main`) — must match Vercel production branch |
| `VERCEL_TOKEN` | Vercel API token |
| `VERCEL_PROJECT_ID` | Optional legacy single-project id; multi-tenant uses per-site projects |
| `VERCEL_TEAM_ID` | Optional, if project is under a team |

Agent options used:

- `workOnCurrentBranch: true` — commits go to `main` so Vercel auto-deploys.
- `autoCreatePR: false` — direct push for simpler MVP.

## Flow

1. User sends a message → `POST /api/chat/send` creates a **BuildRun** (`queued`) for the site (one active build per site).
2. **Worker** (`npm run worker` or `INLINE_BUILD_WORKER=1`) claims the job, runs the coding engine, pushes git, waits for Vercel, writes **BuildEvent** rows.
3. Client opens `GET /api/chat/stream?buildRunId=` → replays/tails events from Postgres (refresh-safe).
4. **SiteResources** stores `cursorAgentId` (and chat session mirrors it) for follow-up runs on the same site.

Auth + sites use **PostgreSQL** (`DATABASE_URL`). See [docs/DATABASE.md](docs/DATABASE.md) (Liara, Docker, or Neon).

## Project layout

```
src/app/api/           — thin HTTP routes
src/lib/               — auth, db, access, build queue, worker loop, chat-send
src/services/          — GitHub, Vercel, Cursor, provisioning, build orchestrator
engines/cursor/        — Cursor engine adapter (SSE → build events)
src/components/Chat.tsx
template/              — GitHub template (AGENTS.md + .cursor/environment.json)
scripts/               — worker, prisma CLI, ops probes
```

## Troubleshooting

- **usage_limit_exceeded / 403** — Cloud Agents need a paid Cursor plan with usage available; see [pricing](https://www.cursor.com/pricing).
- **Missing env** — Server returns 500 with a clear message.
- **409 agent busy** — Wait for the current run to finish before sending again.
- **No preview URL** — Confirm Vercel is linked to the repo, deploy succeeded, and `VERCEL_PROJECT_ID` is correct. First deploy may take a few minutes after the agent pushes.
- **Vercel: “Deployment was blocked … commit author did not have contributing access”** — On **Hobby**, **private** GitHub repos only deploy commits whose **author email matches the GitHub account linked to Vercel**. Ensure Cursor commits as that GitHub user; import the repo on **your** Vercel team, make the repo **public**, or upgrade to **Pro**.
