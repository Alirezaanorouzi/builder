# Customer website — agent instructions

This repository is **one customer’s website**, not a multi-tenant generator. The **Foundation** (Next.js, Tailwind, primitives) provides tools only. **Appearance, content, and layout** come from the user’s request and `DESIGN.md`.

**Template version:** see `TEMPLATE_VERSION` (Foundation v2).

---

## 1. Project mission

- Build or update a real site for this customer’s business and audience.
- Do not assume an industry, layout, or visual style from the starter.
- Prefer maintainable, accessible, production-ready code.

---

## 2. Technology stack

| Layer | Use |
| --- | --- |
| Next.js (App Router) | Framework, routing, metadata |
| TypeScript | All app code |
| React | UI (Server Components by default) |
| Tailwind CSS v4 | Styling (`app/globals.css` tokens) |
| shadcn/ui | Primitives in `components/ui/` |
| Lucide | Icons via existing setup |

**Rules**

- Use **Server Components** unless the UI needs browser state, effects, or event handlers — then add `"use client"`.
- Reuse `components/ui/*` before reinventing buttons, inputs, dialogs, etc.
- Put brand-specific UI in `components/site/`, page blocks in `components/sections/`.
- **Dependencies:** do not add packages without a clear reason (accessibility, performance, maintainability, or a feature you cannot reasonably build). Do not duplicate overlapping UI libraries.

**Required before finish**

```bash
npm run build
```

`next build` already typechecks. Do not also run `npm run typecheck`, `tsc`, lint, or `npm run check`. Run the build in this session — do not hand it to a Task or subagent. Do not open the site in a browser.

---

## 3. Task understanding

Before coding:

1. Read this file.
2. Inspect the repo (pages, components, `app/globals.css`, `package.json`).
3. Read **`DESIGN.md`** if it exists.
4. Use reference images when the user attached them.

Classify the request:

- New website (first real build)
- Change to an existing site
- Visual redesign
- New feature / page
- Conversation only (no site change)

---

## 4. New website workflow

1. Analyze the user’s message (business, audience, goals, language).
2. Choose a design direction appropriate to the brand — not a default SaaS landing template.
3. **Create `DESIGN.md`** at the repo root **before** substantial implementation (see section 5).
4. Update semantic tokens in `app/globals.css`, `lang`/`dir`/fonts in `app/layout.tsx`, and metadata.
5. Implement pages, `components/site/*`, and `components/sections/*` as needed.
6. Run `npm run build` once and fix all errors.
7. Commit and push to `main`.

---

## 5. DESIGN.md

`DESIGN.md` is the **customer design brief**. Create it on the first real site build. Update it when the user changes direction; do not discard the established identity unless they ask for a redesign.

Suggested sections:

1. Brand identity (name, industry, audience, personality, site goal)
2. Language and direction (`lang`, `dir`, typography)
3. Visual direction (concept, keywords, mood)
4. Color system (map to CSS variables in `globals.css`)
5. Typography (heading/body fonts, scale)
6. Layout system (width, grid, spacing, navigation style)
7. Pages and sections required
8. Imagery and media
9. Motion and interaction (add `motion` only if needed)
10. Responsive behavior
11. Content constraints (verified facts vs placeholders — see section 8)
12. Accessibility and SEO notes

Do **not** ship `DESIGN.md` in the Foundation template for new repos — you create it for each customer.

---

## 6. Existing website workflow

1. Read `DESIGN.md` first.
2. Understand current routes and components.
3. Change **only** what the user requested.
4. Preserve visual identity unless they asked for a redesign.
5. Update `DESIGN.md` when design decisions change.
6. Run `npm run build` once, then commit and push.

---

## 7. When not to edit code

Greetings, thanks, or general chat **without** a site change: reply briefly in the user’s language. Do **not** explore the repo, edit files, commit, or push.

---

## 8. Content integrity

Do **not** invent:

- Business facts, addresses, phone numbers, prices
- Testimonials, ratings, years of experience, client logos
- Metrics or awards

Use user-provided content, clear placeholders (e.g. `[Business phone]`), or ask when critical information is missing.

---

## 9. Design principles and visual uniqueness

Match layout and composition to **this** brand — not a generic startup page.

**Avoid using this as the default for every site:**

- Centered navbar → centered hero → three feature cards → logo grid → testimonials → pricing → FAQ → footer

**Consider (when appropriate):** editorial layouts, asymmetric grids, full-bleed imagery, split layouts, typography-led pages, product-focused layouts, bento grids, minimal layouts, visual storytelling.

Diversity should serve the business, not randomness.

---

## 10. Component architecture

| Path | Responsibility |
| --- | --- |
| `app/` | Routes, layouts, metadata |
| `components/ui/` | Generic primitives (shadcn) |
| `components/site/` | Brand-specific reusable UI |
| `components/sections/` | Page sections |
| `lib/` | Shared utilities (`cn` in `lib/utils.ts`) |
| `public/` | Static assets, self-hosted fonts |

Do **not** add pre-made marketing sections to the Foundation; create them per `DESIGN.md`.

---

## 11. Responsive design and localization

- Mobile-first; comfortable from ~360px width upward.
- Set `lang` and `dir` on `<html>` (e.g. `fa` + `rtl` for Persian).
- Prefer **`next/font/local`** with files under `public/fonts/` over relying on Google Fonts for every customer.
- RTL: test alignment, icons, and spacing in both directions.

---

## 12. Accessibility

- Semantic HTML, labels on form fields, keyboard focus visible.
- Sufficient color contrast.
- Meaningful `alt` on images (decorative images: empty alt).

---

## 13. SEO and metadata

- Use the Metadata API in layouts/pages.
- Specific titles and descriptions per page.
- `next/image` for photos where appropriate.
- Add sitemap/robots when the site needs indexing at scale.

---

## 14. Performance

- Minimize Client Components and heavy dependencies.
- Optimize images; avoid layout shift.

---

## 15. Validation

- `npm run build` passes (it includes typecheck).
- Do not test the site in a browser.

---

## 16. Deployment workflow

- Commit with a clear message.
- Push to `main` (production branch for Vercel).
- Report what was actually built or changed.

---

## 17. Completion criteria

Do not finish until:

- [ ] User request implemented
- [ ] `DESIGN.md` exists/updated for site work
- [ ] `npm run build` passes
- [ ] No broken routes or missing critical assets
- [ ] Changes pushed to `main`
- [ ] Summary to user reflects real work (in their language)

---

## 18. Language

Match the **user’s language** in progress updates and final replies. Keep code, paths, and technical identifiers in English when appropriate.
