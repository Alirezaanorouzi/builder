# Multi-tenant architecture (control plane)

This document is the source of truth for scaling the builder beyond the single-repo MVP. It incorporates corrections to the initial proposal: **User → many Sites**, **queue-backed BuildRuns**, **OpenCode workspace isolation**, **auth-owned resources**, and **recoverable provisioning**.

## Planes

| Plane | Responsibility |
|--------|----------------|
| **Control plane** (Next.js) | Auth, users, sites, Postgres, provisioning, build enqueue, SSE from stored events |
| **Execution plane** (workers) | OpenCode/Cursor, git, push, wait for deployment, write results |
| **Infrastructure** | GitHub, Vercel, PostgreSQL |

The MVP agent layer (`engines/*`) stays. What we add is **customer management**, **resource management**, and **concurrent job execution**.

## What the MVP does wrong for multi-tenant

- **Not only** one shared Git repo: the orchestrator reads **global env** (`TEMPLATE_REPO_*`, `VERCEL_PROJECT_ID`) in `config.ts` and `vercel.ts`.
- **Sessions** in JSON + `localStorage` with **no user**; APIs accept `sessionId` without ownership checks.
- **Build lifetime** tied to HTTP/SSE (`stream` runs the agent inline).
- **OpenCode**: one container, one volume `/workspace`, global clone in entrypoint.
- **Vercel**: “latest READY deploy since timestamp” instead of **this build’s commit/deployment**.

Per-customer repos alone do **not** make the app multi-tenant until env-global reads and session trust are removed.

## Entity model

```
User (1)
 └── Site (many)
      ├── SiteResources (1:1) — github + vercel ids, URLs, branch
      ├── ChatSession (many) — engine, engineAgentId (our persistence; not OpenCode-only)
      └── BuildRun (many per session)
           └── BuildEvent (many) — replay for SSE after refresh
```

- **User → Site**: one-to-many (store + corporate site, etc.).
- **Site → SiteResources**: one-to-one.
- **Site → ChatSession**: one-to-many.
- **ChatSession → BuildRun**: one-to-many.
- **BuildRun → BuildEvent**: one-to-many.

### BuildRun status (queue + lifecycle)

`queued` → `preparing_workspace` → `running` → `pushing` → `deploying` → `succeeded` | `failed` | `cancelled`

### Site status (provisioning)

`provisioning` → `active` | `failed` | `suspended`

Provisioning is **not** one atomic transaction. Persist step outcomes and support **retry** (GitHub repo created, Vercel failed, etc.).

Suggested steps:

1. Create GitHub repo (from **template repo** with `is_template: true` on GitHub)
2. Save `githubRepoId` / full name
3. Create Vercel project (`gitRepository` — integration must already access repo on target team)
4. Save `vercelProjectId`, `vercelTeamId`
5. Optional: wait for initial deployment
6. Set site `active`

Starter template should be a **technical Next.js skeleton**, not a fixed clinic design; customer design comes from prompts.

## Request path (security)

Every mutating and read path:

```
Request → Auth → userId from session (never from body)
         → Verify siteId / buildRunId belongs to userId
         → Load SiteResources
         → Operation
```

Applies to **`/api/chat/send`**, **`/api/chat/stream`**, and future site APIs. Stream is keyed by **`buildRunId`**; verify BuildRun ownership, then **replay/stream BuildEvents** — do not execute the agent in the stream handler.

## Build execution flow (target)

```
User → POST /api/chat/send
     → Create BuildRun (queued) + BuildEvents
     → Enqueue (Postgres row; worker claims with SKIP LOCKED)
     → Return { buildRunId } (not long-lived agent work in HTTP)

Worker → Claim job
       → Prepare isolated workspace (clone Site repo)
       → Run engine with tenant context
       → Push git (platform git author policy)
       → Wait for deployment by commitSha / deploymentId
       → Update BuildRun + events

Client → SSE GET /api/builds/:id/stream (or chat stream by buildRunId)
       → Read BuildEvent rows (+ optional live tail)
```

SSE **displays** status; it does **not** own execution.

## Coding engines (tenant context)

Extend `StartRunInput` (and providers) with tenant context, not env globals:

- `siteId`, `repoUrl`, `repoRef`, `workspacePath` (OpenCode)
- Cursor: `repos: [{ url, startingRef }]` from SiteResources
- **One active build per Site** (mutex) to avoid 409 / git conflicts
- Store `engine` + `engineAgentId` on ChatSession; OpenCode session may die with container — **we** own continuity

### OpenCode workspace (phase 1)

One **workspace per BuildRun** (separate container or `/work/{buildRunId}` with **every** API call scoped via OpenCode `directory` / workspace params for v1.19+ — update `client.ts` off legacy assumptions).

Later: worker pool + persistent volumes per site.

## Vercel

Replace global `waitForPreviewUrl({ projectId from env })` with:

```ts
await waitForPreviewUrl({
  projectId: site.resources.vercelProjectId,
  teamId: site.resources.vercelTeamId,
  sinceMs: buildRun.startedAt,
  commitSha: buildRun.commitSha, // preferred
  deploymentId: buildRun.deploymentId,
});
```

Link **this** build to **this** deployment, not “newest READY after timestamp”.

## GitHub App vs commit author

App token authenticates **git operations**. **Author/committer** are set at commit time. Platform policy for Vercel must be explicit (bot user trusted on Vercel team), not assumed from App install alone.

## MVP mapping (keep / change)

| Area | Keep | Change |
|------|------|--------|
| Engine interface | ✓ | Add tenant context |
| Chat API shape | ✓ | Site + BuildRun + auth |
| store.ts | | Postgres |
| config.ts | Platform secrets only | No per-site repo/project in env |
| stream route | | Events from DB, not inline `streamRun` |
| OpenCode docker | | Per-build workspace lifecycle |

See `docs/IMPLEMENTATION-PLAN.md` for file-level checklist and phase order.
