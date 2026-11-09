# Website Foundation (template v2)

Shared **Foundation** for customer sites: Next.js 16, TypeScript, Tailwind CSS v4, and a small set of [shadcn/ui](https://ui.shadcn.com) primitives. It does **not** impose a landing-page design.

## Three layers

| Layer | What |
| --- | --- |
| **Foundation** (this repo) | Tooling, tokens, `components/ui/` |
| **Design system** (per customer) | `DESIGN.md`, tokens, fonts, `components/site/` |
| **Website** (per customer) | Pages, `components/sections/`, content |

## Included

- Next.js App Router, `npm run check` (lint + typecheck + build)
- Tailwind v4 + semantic CSS variables in `app/globals.css`
- shadcn primitives: button, input, textarea, label, dialog, select
- `AGENTS.md` — permanent Cloud Agent rules
- `.cursor/environment.json` — `npm ci` for reproducible installs
- `TEMPLATE_VERSION` — `2.0.0`

Not included: `DESIGN.md` (agent creates on first build), marketing sections, or fixed palettes.

## Local verification

Requires **Node.js 22+**.

```bash
npm ci
npm run check
```

## Publish to GitHub (builder maintainers)

1. Push this folder to **`Alirezaanorouzi/tempelate1`** (or your `TEMPLATE_REPO_URL`).
2. Enable **Template repository** in GitHub repo settings.
3. Set builder `TEMPLATE_REPO_URL` / `TEMPLATE_REPO_REF` (default `main`).

New customer repos are generated from this template; **existing** repos are not auto-upgraded.

From the monorepo:

```bash
npm run sync:template-github:push
```

(when the sync script is available in the builder repo)

## Customer repos

After provision, the agent follows `AGENTS.md`, creates `DESIGN.md`, and builds pages under `app/` and `components/`.
