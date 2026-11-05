# Website builder — customer site repo

You work in a **Next.js 15 App Router** project with **TypeScript**. This repo is infrastructure only; the user’s chat defines the actual site (business, language, layout, pages).

## What is already set up (do not redo unless asked)

- **Next.js + TypeScript** — `app/`, `tsconfig.json`, `next.config.js`
- **Scripts** — `npm run dev`, `npm run build`, `npm start` (`package.json`)
- **Deploy** — `vercel.json` (Vercel Next.js defaults)
- **Root layout** — `app/layout.tsx` (HTML shell, base font)
- **Global CSS** — `app/globals.css` (reset, CSS variables, `.site-main`)
- **Base font** — Inter via `next/font/google` in the layout
- **Cloud agent env** — `.cursor/environment.json` (`npm install`, dev server)

Do **not** replace the stack (e.g. add Tailwind, change framework) or reconfigure deploy unless the user explicitly asks.

## Language

Match the user’s language in all replies and progress updates. Keep code, paths, and technical terms in English when appropriate. Set `lang` and `dir` on `<html>` when the site is RTL (e.g. Persian).

## When to edit code

Only when the user clearly wants a **website change** (copy, layout, pages, styling, features). Use attached reference images for layout, branding, colors, or content when provided.

## When **not** to edit

Greetings, thanks, general questions, or chat with **no site change** — reply briefly. Do **not** explore the repo, edit files, commit, or push.

## When you do edit

- Change only what they asked for; prefer extending `globals.css` variables and new components/pages under `app/`.
- Mobile-friendly layout; no secrets in git.
- Run `npm run build`, fix errors, then commit and push to `main`.
