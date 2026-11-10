# Database: PostgreSQL

The app uses **PostgreSQL** (Liara, Neon, Docker, etc.). SQLite is no longer supported in this branch.

## Connection string

In `.env.local` (and Liara env vars):

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://your-app-domain
```

**Liara:** copy the Postgres connection URL from the Liara dashboard. If connections fail, try appending `?sslmode=require` (or the SSL mode Liara documents).

**Do not commit** real passwords. Use Liara’s env UI for production.

## Apply schema

Schema lives at `src/lib/db/schema.prisma`. On Liara Next.js, Prisma runs in `npm run build` (`build-production.mjs`), not `postinstall`.

First time (empty database):

First time (empty database):

```bash
npm run db:migrate
```

On Liara deploy (CI or release command):

```bash
npx prisma migrate deploy
```

Regenerate client after pull:

```bash
npx prisma generate
```

## Local Postgres without Liara

```bash
docker compose -f docker-compose.db.yml up -d
```

```env
DATABASE_URL=postgresql://builder:builder@127.0.0.1:5434/builder
```

## Worker / queue

- **Builds:** `FOR UPDATE SKIP LOCKED` on `BuildRun`.
- **Provisioning:** DB lease on `SiteResources` (`provisioningLeaseUntil`, `provisioningWorkerId`) — safe with multiple workers.

Env: `WORKER_MODE` (`all` | `builds` | `provisioning`), `WORKER_ID`, `WORKER_POLL_MS`, `PROVISIONING_LEASE_MINUTES`.

## Admin users

`ADMIN_EMAIL` + `ADMIN_PASSWORD` — sign in at `/admin/sign-in` (separate from customer auth). Dashboard: North Star, funnel, messages, feature flags. APIs under `/api/admin/*` require the `admin_session` cookie.

`ADMIN_EMAILS=comma,separated,emails` — legacy role promotion on customer login (optional).

After deploy, run migrations so `ProductEvent` and `FeatureFlag` exist (`npm run db:migrate` or Liara start migrate).

After editing `src/lib/db/schema.prisma` or migrations, run **`npm run db:sync-assets`** and commit **`prisma-assets.mjs`** — Liara build restores schema from that file.

## Optional local SQLite (historical)

Older commits used `file:./dev.db`. After switching to Postgres, create a **fresh** Liara or Docker database — do not point Postgres at an old SQLite file.
