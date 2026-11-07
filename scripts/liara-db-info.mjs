import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local") });

const token = (process.env.LIARA_API_TOKEN || process.env.LIARA_API_KEY || "").trim();
const teamId = (process.env.LIARA_TEAM_ID || "").trim();

function liara(args) {
  const extra = ["--api-token", token];
  if (teamId) extra.push("--team-id", teamId);
  const r = spawnSync("npx", ["liara", ...args, ...extra], {
    encoding: "utf8",
    cwd: process.cwd(),
    shell: true,
  });
  return r;
}

function redact(s) {
  return String(s)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://***REDACTED***")
    .replace(/:[^:@/\s]{6,}@/g, ":***@")
    .replace(/"password"\s*:\s*"[^"]+"/gi, '"password":"***"');
}

for (const args of [
  ["db", "info", "builder"],
  ["db", "show", "builder"],
  ["postgres", "info", "builder"],
  ["app", "info", "builder1"],
  ["network", "list"],
]) {
  const r = liara(args);
  console.log("CMD", args.join(" "), "status", r.status);
  console.log(redact((r.stdout || "") + (r.stderr || "")).slice(0, 3500));
  console.log("---");
}
