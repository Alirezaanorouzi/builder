export function wrapUserPrompt(userMessage: string): string {
  return `You are customizing a small business website from the existing template in this repository.

User request:
${userMessage.trim()}

Instructions:
- Keep changes focused on the user's request.
- Prefer editing existing pages and components over rewriting the whole project.
- Use the stack already in the repo (Next.js).
- Ensure the site looks good on mobile.
- After making changes, run the project's build or dev check if available and fix obvious errors.
- Commit and push your changes to the configured branch when done.
`;
}
