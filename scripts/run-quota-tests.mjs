import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["tsx", "--test", "src/lib/quota/engine.test.ts"], {
  stdio: "inherit",
  shell: true,
});
process.exit(r.status ?? 1);
