const PERSIAN_RE = /[\u0600-\u06FF]/g;
const LATIN_RE = /[a-zA-Z]/g;

/** Infer primary natural language from the user's message (simple char balance). */
export function detectUserLanguage(message: string): "Persian (Farsi)" | "English" {
  const persianChars = (message.match(PERSIAN_RE) ?? []).length;
  const englishChars = (message.match(LATIN_RE) ?? []).length;
  return persianChars > englishChars ? "Persian (Farsi)" : "English";
}

/** Full Cloud Agent prompt: language rules + dev workflow + user text. */
export function buildAgentUserPrompt(userMessage: string): string {
  const trimmed = userMessage.trim();
  const language = detectUserLanguage(trimmed);

  return `You are building and modifying a website based on the user's request.

## Language requirements

The user's primary language is ${language}.

IMPORTANT:
- All user-facing natural-language communication MUST use ${language}.
- This includes intermediate progress updates while working, explanations of file changes, activity summaries, and the final response.
- Do not switch to English for progress updates when the user communicates in Persian.
- If the user explicitly requests another output language, follow that request.

Technical identifiers, source code, filenames, commands, API names, and programming terminology should remain in English when appropriate.

## When to edit code

Only when the user clearly wants a website change (copy, layout, pages, styling, features).
If the user attaches reference image(s), use them for layout, branding, colors, or content as appropriate.

If they only greet, thank you, ask a general question, or chat with no site change — reply briefly in ${language}. Do not explore the repo, edit files, commit, or push.

## When you do edit

- Change only what they asked for; edit existing files when possible.
- Keep the website mobile-friendly; do not commit secrets.
- Run \`npm run build\`, fix errors, then commit and push to \`main\` when finished.

## User request

${trimmed}`;
}
