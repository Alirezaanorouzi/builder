# Website Builder MVP

Minimal chat app that sends prompts to a **coding engine** (Cursor Cloud Agents or self-hosted **OpenCode**), streams build progress over **SSE**, and returns a **Vercel preview URL** when deploy finishes.

Switch engines with `CODING_ENGINE=cursor` or `CODING_ENGINE=opencode` in `.env.local`. See `engines/README.md`.

## What you need before running

1. **Cursor** — Premium (or higher) with Cloud Agents enabled and GitHub connected in [Integrations](https://cursor.com/dashboard).
2. **API key** — [Dashboard → API Keys](https://cursor.com/dashboard) → set `CURSOR_API_KEY`.
3. **Template repo** — Push `template/` to GitHub (private is fine). Cursor must have read/write access.
4. **Vercel** — Import the same GitHub repo as a project. Note **Project ID** and create a [token](https://vercel.com/account/tokens).

> **Multi-tenant:** Per-user sites get their own GitHub repo + Vercel project after sign-in. Builds run via **BuildRun** queue + worker (see below).

**Multi-tenant roadmap:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md). Provisioning: [docs/PROVISIONING.md](docs/PROVISIONING.md). Schema: `prisma/schema.prisma`.

## Setup

```bash
cd builder
cp .env.example .env.local
# Edit .env.local with your keys and repo URL

npm install
npm run db:up
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
| `VERCEL_PROJECT_ID` | From Vercel project settings |
| `VERCEL_TEAM_ID` | Optional, if project is under a team |

Agent options used:

- `workOnCurrentBranch: true` — commits go to `main` so Vercel auto-deploys.
- `autoCreatePR: false` — direct push for simpler MVP.

## Flow

1. User sends a message → `POST /api/chat/send` creates a **BuildRun** (`queued`) for the site (one active build per site).
2. **Worker** (`npm run worker` or `INLINE_BUILD_WORKER=1`) claims the job, runs the coding engine, pushes git, waits for Vercel, writes **BuildEvent** rows.
3. Client opens `GET /api/chat/stream?buildRunId=` → replays/tails events from Postgres (refresh-safe).
4. Chat session stores `engineAgentId` in Postgres for follow-up runs on the same site.

Auth + sites use **PostgreSQL** (`DATABASE_URL`). Legacy `.data/sessions.json` is removed.

## Project layout

```
src/app/api/chat/send   — start agent run
src/app/api/chat/stream — SSE proxy + Vercel URL
src/components/Chat.tsx — mobile-friendly UI
engines/cursor/         — Cursor Cloud Agents provider
engines/opencode/       — OpenCode + Docker worker
template/               — seed repo to push to GitHub
```

## Troubleshooting

- **usage_limit_exceeded / 403** — Plus plan does not include Cloud Agents; upgrade plan or check usage.
- **Missing env** — Server returns 500 with a clear message.
- **409 agent busy** — Wait for the current run to finish before sending again.
- **OpenCode `Session not found` (404)** — The OpenCode Docker container was restarted; in-memory sessions are gone. Send a new message (the worker recreates an OpenCode session automatically).
- **No preview URL** — Confirm Vercel is linked to the repo, deploy succeeded, and `VERCEL_PROJECT_ID` is correct. First deploy may take a few minutes after the agent pushes.
- **Vercel: “Deployment was blocked … commit author did not have contributing access”** — On **Hobby**, **private** GitHub repos only deploy commits whose **author email matches the GitHub account linked to Vercel** (no extra collaborators without **Pro**). Fix: in `engines/opencode/docker/.env` set `TEMPLATE_REPO_GIT_EMAIL` to your GitHub **primary or noreply** email (e.g. `id+username@users.noreply.github.com` from [GitHub email settings](https://github.com/settings/emails)), then `docker compose up -d --force-recreate`. **Also check:** the Vercel project must live on **your** Vercel account/team (GitHub → commit → “Details” link). If it shows a different team (e.g. `alis-projects-…`) than your dashboard, disconnect the repo from that account and import it under your team, or make the repo **public**, or upgrade to **Pro**.
