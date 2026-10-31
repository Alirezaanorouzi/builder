# OpenCode engine (Docker)

Headless **OpenCode** worker for the website builder MVP.

## Start the worker

1. Copy env:

   ```bash
   cd engines/opencode/docker
   cp .env.example .env
   ```

   Edit `docker/.env`:

   ```env
   TEMPLATE_REPO_URL=https://github.com/you/builder-clinic-template
   TEMPLATE_REPO_REF=main
   TEMPLATE_REPO_TOKEN=ghp_...     # git clone + push (not GITHUB_TOKEN — avoids Copilot)
   TEMPLATE_REPO_GIT_EMAIL=you@example.com   # MUST match GitHub account linked to Vercel
   TEMPLATE_REPO_GIT_NAME=Your Name
   OPENCODE_SERVER_PASSWORD=builder-dev-secret
   OPENROUTER_API_KEY=sk-or-v1-...
   ```

   **Vercel Hobby + private repo:** Vercel only accepts commits authored by **you** (the Vercel/GitHub owner). Wrong or missing `TEMPLATE_REPO_GIT_EMAIL` → “Deployment was blocked”. Pro is required to add other team members on private repos.

2. Run:

   ```bash
   docker compose up -d --build
   ```

3. Check health:

   ```bash
   curl -u opencode:builder-dev-secret http://127.0.0.1:4096/global/health
   ```

## Wire the Next.js app

In `builder/.env.local`:

```env
CODING_ENGINE=opencode
OPENCODE_SERVER_URL=http://127.0.0.1:4096
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=builder-dev-secret
```

Switch back to Cursor:

```env
CODING_ENGINE=cursor
```

## Notes

- One container = one shared `/workspace` clone (same MVP limitation as a single template repo).
- After OpenCode finishes, the backend runs `git push` via the OpenCode shell API (with `TEMPLATE_REPO_GIT_*` author).
- Vercel preview URL logic polls deployments (or falls back to `VERCEL_PRODUCTION_URL` if the API token lacks access).
