# Deploy on Liara

Host the **builder** Next.js app on [Liara](https://liara.ir) with Liara PostgreSQL.

## 1. Liara resources

1. **PostgreSQL** — create in Liara; set `DATABASE_URL` on the app (with `?sslmode=require` if needed).
2. **Next.js app** — e.g. `builder1` on your team; platform **Next**.
3. **Environment variables** on the app (mirror `.env.example`, not `.env.local`):
   - `DATABASE_URL` — required at **build** and runtime
   - `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` — public URL, e.g. `https://builder1.liara.run`
   - **Cursor:** either **`CURSOR_API_KEY`** (if Cursor allows your egress), or **[`gateway/`](../gateway/) on Vercel** with  
     **`CURSOR_TRANSPORT=gateway`**, **`ENGINE_GATEWAY_URL`**, **`ENGINE_GATEWAY_TOKEN`** and **no** `CURSOR_API_KEY` on Liara
   - **Deploy poll latency:** gateway env **`VERCEL_TOKEN`** + **`VERCEL_TEAM_ID`**; Liara **`ENGINE_GATEWAY_URL`** + **`ENGINE_GATEWAY_TOKEN_VERCEL`** (or shared `ENGINE_GATEWAY_TOKEN`). Liara keeps **`VERCEL_TOKEN`** for provisioning. Optional **`VERCEL_DEPLOYMENTS_TRANSPORT=direct`** to debug without gateway.
   - `TEMPLATE_REPO_URL`, `PLATFORM_GITHUB_TOKEN`, `GITHUB_REPO_OWNER`
   - `VERCEL_TOKEN`, `VERCEL_TEAM_ID`
   - **`INLINE_BUILD_WORKER`** — defaults to **on** (polls GitHub/Vercel provisioning + builds in-process). Set `INLINE_BUILD_WORKER=0` on the web app only if you run a **separate** worker Liara app (`npm run worker`).

See [DATABASE.md](./DATABASE.md) and [PROVISIONING.md](./PROVISIONING.md).

## 2. Automatic deploy from GitHub (recommended)

1. In [Liara console](https://console.liara.ir) → your app → **Git** / **استقرار خودکار**.
2. Connect **`https://github.com/Alirezaanorouzi/builder`**, branch **`main`**, platform **Next.js**.
3. Select the correct **team** if the app is not on your personal account.
4. Set all env vars in Liara (step 1) before the first deploy.
5. Push to **`main`** on GitHub — Liara builds and deploys automatically.

**`liara.json`** in the repo root configures the build (Node 22, npm mirror off). Do **not** put `app` or `platform` in `liara.json` when using GitHub deploy (Liara sets those in the console).

Build steps Liara runs (GitHub or CLI):

- `npm ci` — install dependencies
- `npm run build` → [`build-production.mjs`](../build-production.mjs) → [`prisma-postinstall.mjs`](../prisma-postinstall.mjs) (restore schema from `prisma-assets.mjs` + `prisma generate`) → `next build` (DB not required)
- **Runtime** — Liara often runs **standalone** `node server.js`, not `npm start`. Migrations therefore run from [`src/instrumentation.ts`](../src/instrumentation.ts), which **spawns** [`scripts/apply-embedded-migrations.mjs`](../scripts/apply-embedded-migrations.mjs) (embedded SQL from `prisma-assets.mjs`). [`start-production.mjs`](../start-production.mjs) only binds `next start` to `0.0.0.0:$PORT`.
- Set **`SKIP_AUTO_MIGRATE=1`** on the app if you apply migrations yourself (e.g. `npx prisma migrate deploy` from your machine using the **public** `DATABASE_URL`).

If migration fails, the server **exits** (so you do not get a “healthy” release against an outdated schema).
n
Prisma schema lives at **`src/lib/db/schema.prisma`**. Liara’s Next packer can omit `.prisma` files; `prisma-postinstall.mjs` writes them from `prisma-assets.mjs` during **build**, not `postinstall`.

### Why each deploy feels long

- **Next.js production build** compiles the whole app; standalone output traces many files (including `@cursor/sdk` by design).
- **Prisma generate** runs during `npm run build` (every clean install on the builder).
- **Iran build region** ([`build.location`](../liara.json)) can add latency versus a builder next to you.
- **`npm run deploy:liara`** used to pass `--no-cache` (full Docker/npm layer rebuild); that is now **opt-in** via `LIARA_DEPLOY_NO_CACHE=1` for debugging sticky builds.

Nothing in this repo is “extra” in the sense of duplicate work on purpose: `prisma-postinstall` exists because Liara’s packer omits Prisma files; the gateway folder is **[`.liaraignore`](../.liaraignore)** so it is not uploaded with the main app.

Copy app secrets from `.env.local` onto Liara (skips `LIARA_*` CLI keys; rewrites localhost `BETTER_AUTH_URL` to `https://<app>.liara.run`):

```bash
npm run env:liara
```

## 3. Manual deploy (CLI)

For one-off deploys from your machine:

```env
# .env.local — not committed
LIARA_API_TOKEN=...   # or LIARA_API_KEY
LIARA_APP_ID=builder1
LIARA_TEAM_ID=...
```

```bash
npm run deploy:liara
# Only if you need a completely cold build:
# LIARA_DEPLOY_NO_CACHE=1 npm run deploy:liara   # Unix
# $env:LIARA_DEPLOY_NO_CACHE='1'; npm run deploy:liara   # PowerShell
```

## 4. Optional worker app

Separate **Node** Liara app: start command `npm run worker`, same DB and API env vars, `WORKER_MODE=all`. Disable `INLINE_BUILD_WORKER` on the web app. Live chat events are stored in Postgres (`BuildEvent`), so the web app and the worker only need to share the database — a separate worker no longer breaks live progress. Interrupted runs are recovered automatically (heartbeat + re-attach).

## 5. Troubleshooting

- **App logs** — Console: your app → **Logs**. From the repo (uses `LIARA_API_TOKEN` / `LIARA_API_KEY` from `.env.local`, does not print the token): `npm run logs:liara` ([`scripts/liara-logs-api.mjs`](../scripts/liara-logs-api.mjs)) calls `GET https://api.iran.liara.ir/v1/projects/{app}/logs?since=<unix_seconds>` per [Liara PaaS API](https://developers.liara.ir/). If `npx liara logs` fails, use this script instead. Release state: `npm run status:liara`.
- **Container unhealthy** — If releases show `UNHEALTHY` while the build succeeds, Next may be listening only on `127.0.0.1`. [`start-production.mjs`](../start-production.mjs) runs `next start -H 0.0.0.0 -p $PORT`. Override with `LISTEN_HOST` if needed.
- **Build: Prisma schema not found during `npm ci`** — do not run Prisma in `postinstall`. Generation happens in `npm run build`.
- **Migrate P1001 during build** — expected if Postgres is private. Migrations run on **start**, not build. Use the **private** `DATABASE_URL` on the Liara app.
- **npm mirror errors** — `mirror: false` in `liara.json`.

Docs: [Liara Next.js](https://docs.liara.ir/paas/nextjs/how-tos/deploy-app/)
