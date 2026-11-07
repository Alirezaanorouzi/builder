import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local") });

const token = (process.env.LIARA_API_TOKEN || process.env.LIARA_API_KEY || "").trim();
const teamId = (process.env.LIARA_TEAM_ID || "").trim();

function run(args) {
  const extra = ["--api-token", token];
  if (teamId) extra.push("--team-id", teamId);
  const r = spawnSync("npx", ["liara", ...args, ...extra], {
    encoding: "utf8",
    cwd: process.cwd(),
    shell: true,
    timeout: 45000,
  });
  console.log("CMD", args.join(" "), "status", r.status);
  console.log(((r.stdout || "") + (r.stderr || "")).slice(0, 4000));
  console.log("---");
}

run(["network", "--help"]);
run(["help", "network"]);
run(["app", "--help"]);
