# Deploy on Liara

Host the **builder** Next.js app on [Liara](https://liara.ir) with Liara PostgreSQL.

## 1. Liara resources

1. **PostgreSQL** — create in Liara; set `DATABASE_URL` on the app (with `?sslmode=require` if needed).
2. **Next.js app** — e.g. `builder1` on your team; platform **Next**.
3. **Environment variables** on the app (mirror `.env.example`, not `.env.local`):
   - `DATABASE_URL` — required at **build** and runtime
   - `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` — public URL, e.g. `https://builder1.liara.run`
   - `CURSOR_API_KEY`, `TEMPLATE_REPO_URL`, `PLATFORM_GITHUB_TOKEN`, `GITHUB_REPO_OWNER`
   - `VERCEL_TOKEN`, `VERCEL_TEAM_ID`
   - `INLINE_BUILD_WORKER=1` — run builds inside the web process (or use a separate worker app)

See [DATABASE.md](./DATABASE.md) and [PROVISIONING.md](./PROVISIONING.md).

## 2. Automatic deploy from GitHub (recommended)

1. In [Liara console](https://console.liara.ir) → your app → **Git** / **استقرار خودکار**.
2. Connect **`https://github.com/Alirezaanorouzi/builder`**, branch **`main`**, platform **Next.js**.
3. Select the correct **team** if the app is not on your personal account.
4. Set all env vars in Liara (step 1) before the first deploy.
5. Push to **`main`** on GitHub — Liara builds and deploys automatically.

**`liara.json`** in the repo root configures the build (Node 22, npm mirror off). Do **not** put `app` or `platform` in `liara.json` when using GitHub deploy (Liara sets those in the console).

Build steps Liara runs:

- `npm install` → `postinstall` → `prisma generate`
- `npm run build` → `scripts/build-production.mjs` (migrate if `DATABASE_URL`, then `next build`)
- `npm start` → `next start`

Prisma schema lives at **`src/lib/db/schema.prisma`**. Liara’s Next.js packer drops `.prisma` files, so `scripts/prisma-postinstall.mjs` writes the schema from an embedded JS copy before `prisma generate`.

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
```

## 4. Optional worker app

Separate **Node** Liara app: start command `npm run worker`, same DB and API env vars, `WORKER_MODE=all`. Disable `INLINE_BUILD_WORKER` on the web app.

## 5. Troubleshooting

- **Build: Prisma schema not found** — Liara Next.js omits `.prisma` files; `postinstall` recreates them from `scripts/prisma-assets.mjs`.
- **Migrate fails** — set `DATABASE_URL` on the Liara app before deploy.
- **npm mirror errors** — `mirror: false` in `liara.json`.

Docs: [Liara Next.js](https://docs.liara.ir/paas/nextjs/how-tos/deploy-app/)
