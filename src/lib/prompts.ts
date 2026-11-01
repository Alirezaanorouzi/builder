export function wrapUserPrompt(userMessage: string): string {
  return `Customize this Next.js site template per the user request. Edit existing files; keep mobile-friendly layout; run build if available and fix errors; commit and push when done.

User request:
${userMessage.trim()}
`;
}
