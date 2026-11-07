import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local") });

const token = (process.env.LIARA_API_TOKEN || process.env.LIARA_API_KEY || "").trim();
const teamId = (process.env.LIARA_TEAM_ID || "").trim();

function liara(args) {
  const full = ["liara", ...args, "--api-token", token, "--output", "json"];
  if (teamId) full.push("--team-id", teamId);
  return spawnSync("npx", full, { encoding: "utf8", cwd: process.cwd(), shell: true });
}

function redact(s) {
  return String(s)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://***")
    .replace(/"password"\s*:\s*"[^"]+"/gi, '"password":"***"');
}

for (const args of [["db", "list"], ["database", "list"], ["app", "list"]]) {
  const r = liara(args);
  console.log("CMD", args.join(" "), "status", r.status);
  console.log(redact((r.stdout || r.stderr || "").slice(0, 4000)));
  console.log("---");
}
