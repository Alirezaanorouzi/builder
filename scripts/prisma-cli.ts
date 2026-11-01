/**
 * Run Prisma CLI with .env.local (Next.js) then .env fallback.
 */
import { spawnSync } from "child_process";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: tsx scripts/prisma-cli.ts <prisma args…>");
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", ...args], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
