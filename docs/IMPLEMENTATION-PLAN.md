# Implementation plan

Order chosen to build a **tenant-aware control plane** before scaling OpenCode containers.

## Phase 1 — Database (start here)

- [x] PostgreSQL local Docker + Prisma schema (`prisma/schema.prisma`)
- [x] Better Auth tables merged into schema
- [x] Migrate off `.data/sessions.json` (removed `store.ts`; chat uses Prisma)
- [x] Data access: `sites.ts`, `access.ts`, `db.ts`

## Phase 2 — Authentication & authorization

- [x] Better Auth (email/password) + `/api/auth/[...all]`
- [x] Middleware cookie check for `/`, `/api/chat/*`, `/api/me`
- [x] `assertSiteAccess`, `assertBuildRunAccess`, `assertChatSessionAccess`
- [x] Chat APIs require session; `userId` from auth only (not request body)
- [x] Sign-in page at `/sign-in`
- [x] Stream keyed by `buildRunId` + ownership check

## Phase 3 — Site provisioning (recoverable)

- [x] `src/lib/provisioning/` — step runner with persisted state
- [ ] Mark GitHub source template `is_template: true` — **manual in GitHub Settings** (see [PROVISIONING.md](./PROVISIONING.md))
- [x] GitHub: create repo from template → save ids
- [x] Vercel: create project linked to repo → save ids
- [x] Retry failed steps (`POST /api/sites/:id/provision`)
- [x] Optional initial deploy wait before `active`

## Phase 4 — Tenant-aware engines

- [x] `engines/types.ts` — `TenantContext` on `StartRunInput`
- [x] `engines/cursor/client.ts` — repo from tenant
- [x] `engines/opencode/client.ts` — workspace/directory on session/shell calls
- [x] `src/lib/platform-config.ts` — platform tokens for provisioning
- [x] Active sites require dedicated `SiteResources` (no silent global fallback unless `ALLOW_SHARED_MVP_FALLBACK=1`)

## Phase 5 — Build queue & worker

- [x] `POST /api/chat/send` — create BuildRun `queued`, one active build per site, return `buildRunId`
- [x] Worker — `npm run worker` (`scripts/build-worker.ts`, Postgres `SKIP LOCKED`)
- [x] `GET /api/chat/stream?buildRunId=` — SSE from `BuildEvent` (+ tail)
- [x] `Chat.tsx` — `buildRunId` stream + refresh reconnect

## Phase 6 — OpenCode workspace isolation

- [x] Per BuildRun path `/workspaces/{siteId}/{buildRunId}` + cleanup after build
- [x] OpenCode `directory` on session, prompt, shell, status, events
- [ ] Optional: ephemeral container per build (future cost optimization)

## Phase 7 — Deployment tracking

- [x] Store `commitSha` on push (OpenCode)
- [x] `waitForDeployment` by commit + `deploymentId` on BuildRun
- [x] Per-site Vercel project/team in worker

## File change map (current repo)

| Path | Status |
|------|--------|
| `src/lib/build-runs.ts`, `execute-build-run.ts`, `build-worker.ts` | Build queue + execution |
| `scripts/build-worker.ts` | Worker entry |
| `src/app/api/chat/send/route.ts` | Enqueue only |
| `src/app/api/chat/stream/route.ts` | Event replay/tail |
| `src/components/Chat.tsx` | buildRunId SSE |
| `src/lib/vercel.ts` | `waitForDeployment` |
| `docs/PROVISIONING.md` | Ops + template checklist |

## What stays as-is for now

- Chat UI patterns and SSE event names (mapped to `BuildEvent.eventType`)
- Engine provider split (Cursor / OpenCode)
- Template folder as **source** for GitHub template generation
