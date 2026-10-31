import { getCodingEngineId } from "@/lib/config";
import type { CodingEngineProvider } from "./types";
import { cursorEngineProvider } from "./cursor/provider";
import { opencodeEngineProvider } from "./opencode/provider";

export type { CodingEngineId, CodingEngineProvider, EngineStreamEvent } from "./types";

export { getCodingEngineId };

export function getCodingEngine(): CodingEngineProvider {
  return getCodingEngineId() === "opencode" ? opencodeEngineProvider : cursorEngineProvider;
}
