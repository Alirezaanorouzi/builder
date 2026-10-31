# Database: local Docker vs Neon

**Neon does not run inside Docker.** Neon is managed PostgreSQL in the cloud. Your app only needs a `DATABASE_URL` (PostgreSQL connection string).

## Local development

```bash
docker compose -f docker-compose.db.yml up -d
```

In `.env.local`:

```env
DATABASE_URL=postgresql://builder:builder@127.0.0.1:5434/builder
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
```

Apply schema:

```bash
npm run db:migrate
```

## Production (Neon)

1. Create a project at [neon.tech](https://neon.tech) (or Vercel Marketplace → Neon).
2. Copy the **pooled** connection string into Vercel env as `DATABASE_URL`.
3. Set `BETTER_AUTH_URL` to your production domain.
4. Run migrations in CI or `npx prisma migrate deploy`.

Same Prisma schema works for both — only the URL changes.
