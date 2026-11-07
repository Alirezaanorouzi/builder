/**
 * Runtime start: apply migrations (private Liara DB is reachable here), then Next.js.
 *
 * Liara health checks hit the container from outside the process network namespace.
 * Next must listen on all interfaces — default localhost-only binding yields UNHEALTHY.
 */
import { execSync } from "node:child_process";

function run(cmd) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

// Migrations run in src/instrumentation.ts (runs for `node server.js` and `next start`).
// Keep start focused on binding for Liara health checks.

const port = (process.env.PORT || "3000").trim();
/** Do not use `HOSTNAME` (container id) — Liara health checks need a public bind. */
const listenHost = (process.env.LISTEN_HOST || "0.0.0.0").trim();
run(`npx next start -H ${listenHost} -p ${port}`);
