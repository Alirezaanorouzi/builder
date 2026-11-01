import type { CodingEngineProvider } from "./types";
import { cursorEngineProvider } from "./cursor/provider";

export type { CodingEngineId, CodingEngineProvider, EngineStreamEvent } from "./types";

export { getCodingEngineId } from "@/lib/config";

export function getCodingEngine(): CodingEngineProvider {
  return cursorEngineProvider;
}
