/**
 * Execution plane worker — run alongside Next.js dev:
 *   npm run worker
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

import { runBuildWorkerLoop } from "../src/lib/build-worker";

void runBuildWorkerLoop();
