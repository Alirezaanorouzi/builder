# Cursor agent gateway (Vercel)

<!-- Vercel: connect Git `Alirezaanorouzi/builder-cursor-gateway`, branch `main`. -->

Small **Next.js 15 App Router** proxy: your builder (e.g. on Liara) calls this with `Authorization: Bearer ENGINE_GATEWAY_TOKEN`, and the gateway forwards **only** allow-listed paths to `https://api.cursor.com` using `CURSOR_API_KEY`.

## Deploy

1. Create a Vercel project with **root directory** `gateway` (or deploy this folder only).
2. Set env on the Vercel project:
   - `CURSOR_API_KEY` — Cursor API key (stays on Vercel only)
   - `ENGINE_GATEWAY_TOKEN` — long random secret; copy to the builder as `ENGINE_GATEWAY_TOKEN`
3. Region is pinned in `vercel.json` (`fra1` by default). Change if needed.
4. Production URL will look like `https://your-project.vercel.app`. The builder uses **`https://your-project.vercel.app`** as `ENGINE_GATEWAY_URL` (do not add `/api/cursor`; the app appends that).

## Security

- Do not commit tokens. Treat a leaked `ENGINE_GATEWAY_TOKEN` like a leaked API key (rotate both).
- Only these Cursor paths are proxied: create agent, follow-up run, get run, run stream, cancel.
