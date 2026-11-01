# Database: SQLite (MVP) vs Postgres (production scale)

**Default for local MVP:** a SQLite file — no Docker Postgres required.

## Local development

In `.env.local`:

```env
DATABASE_URL="file:./dev.db"
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
```

Apply schema:

```bash
npm run db:migrate
```

Or for a quick throwaway DB:

```bash
npm run db:push
```

The SQLite file lives next to `prisma/schema.prisma` (typically `prisma/dev.db`) and is gitignored. Use **one worker process** (`npm run worker`) when processing builds — SQLite does not support `FOR UPDATE SKIP LOCKED`.

## Optional: local Postgres (Docker)

If you prefer Postgres locally:

```bash
docker compose -f docker-compose.db.yml up -d
```

Set `DATABASE_URL=postgresql://builder:builder@127.0.0.1:5434/builder`, change `provider` in `prisma/schema.prisma` to `postgresql`, and use a Postgres migration baseline.

## Production (Neon or other Postgres)

1. Create a Postgres database (e.g. [neon.tech](https://neon.tech)).
2. Set `DATABASE_URL` to the pooled connection string.
3. Switch `datasource db` in `prisma/schema.prisma` to `provider = "postgresql"`.
4. Run `npx prisma migrate deploy` in CI or release.

Same Prisma models work for SQLite and Postgres — only the provider, URL, and worker scaling model change.
