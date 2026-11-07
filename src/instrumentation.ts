/**
 * Runs on every Next.js server start (including `node .next/standalone/server.js`), not only `npm start`.
 * Dynamic imports with webpackIgnore keep Node built-ins out of the webpack graph.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.DATABASE_URL?.trim() && process.env.SKIP_AUTO_MIGRATE !== "1") {
    const { execFileSync } = await import(/* webpackIgnore: true */ "node:child_process");
    const { join } = await import(/* webpackIgnore: true */ "node:path");
    const script = join(process.cwd(), "scripts", "apply-embedded-migrations.mjs");
    execFileSync(process.execPath, [script], { stdio: "inherit", env: process.env });
  }

}
