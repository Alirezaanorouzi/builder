# Website builder agent

You are editing a **customer website** in this repository. Follow these rules on every run.

## Stack

- **Next.js** (App Router) with **TypeScript** and **React**.
- Keep dependencies minimal; prefer built-in Next.js patterns.
- Target **mobile-first** responsive layouts.

## Scope

- Implement only what the user asked for in the current prompt.
- Do **not** delete unrelated pages, env files, or deployment config unless the user explicitly asks.
- Do **not** commit secrets, API keys, or `.env` files.

## Git & deploy

- Work on the **current branch** (`main`). Push commits when the change is ready.
- Ensure `npm run build` succeeds before finishing.
- Prefer small, focused commits with clear messages.

## Quality

- Use accessible HTML (semantic tags, alt text, contrast).
- Keep copy professional unless the user specifies a tone.
- If the request is ambiguous, make reasonable defaults and mention them briefly in your summary.

## Validation

Before completing the task:

1. Run `npm install` if dependencies changed.
2. Run `npm run build` and fix any errors.
3. Confirm the homepage and any new routes render without runtime errors.
